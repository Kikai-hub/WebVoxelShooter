// Сетевой тест: поднимает настоящий сервер комнаты, регистрирует 3 игроков и подключает их
// по WebSocket. Клиенты ходят по карте, предсказывают своё движение тем же кодом, что браузер,
// и проверяют:
//  1) расхождение предсказания с сервером (сколько мягких и резких поправок);
//  2) совпадает ли позиция чужого игрока в снапшоте с его настоящей позицией на том же тике;
//  3) видят ли игроки друг друга: союзник всегда в снапшоте, враг — всякий раз, когда есть прямая видимость;
//  4) равномерность снапшотов (пропуски тиков).
// Запуск: npm run test:net -- [секунд=60] [задержка в одну сторону, мс=40] [дрожание, мс=20] [карта=market]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  BTN_FWD,
  BTN_RIGHT,
  copyPState,
  decodeSnapshot,
  DT,
  encodeCmds,
  eyeHeight,
  lineOfSight,
  MAPS,
  type MapInfo,
  NavGrid,
  newPState,
  type PState,
  SF_ALIVE,
  SF_CROUCH,
  SF_ONGROUND,
  type Snapshot,
  stepPlayer,
  TICK_RATE,
  type UserCmd,
  WEAPONS,
} from '../shared/src/index';

const DURATION = Number(process.argv[2] ?? 60);
const LATENCY = Number(process.argv[3] ?? 40);
const JITTER = Number(process.argv[4] ?? 20);
const START_MAP = process.argv[5] ?? 'market';
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = mkdtempSync(join(tmpdir(), 'vts-netcheck-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/main.ts'], {
  env: { ...process.env, GAME_PORT: String(PORT), DATA_DIR: dataDir, START_MAP, BOT_LEVEL: 'medium' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const mapCache = new Map<string, { info: MapInfo; nav: NavGrid }>();
function getMap(id: string) {
  let m = mapCache.get(id);
  if (!m) {
    const info = MAPS[id]();
    m = { info, nav: new NavGrid(info.map, [...info.spawns[0], ...info.spawns[1]]) };
    mapCache.set(id, m);
  }
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Канал с искусственной задержкой и дрожанием, сохраняющий порядок (как TCP). */
class LaggyPipe {
  private last = 0;
  private queue: Array<{ at: number; fn: () => void }> = [];
  private timer: NodeJS.Timeout | null = null;
  push(fn: () => void) {
    const at = Math.max(this.last, performance.now() + LATENCY + Math.random() * JITTER);
    this.last = at;
    this.queue.push({ at, fn });
    this.schedule();
  }
  // одна очередь и один таймер: у отдельных setTimeout с дробной задержкой порядок не гарантирован
  private schedule() {
    if (this.timer || !this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.queue.length && this.queue[0].at <= now + 0.5) this.queue.shift()!.fn();
      this.schedule();
    }, Math.max(0, this.queue[0].at - performance.now()));
  }
}

interface Stats {
  reconciles: number;
  errs: number[];
  smooth: number;
  snaps: number;
  snapGapMax: number;
  snapGaps: number;
  respawns: number;
}

class Client {
  ws!: WebSocket;
  id = -1;
  team = -1;
  spectator = true;
  mapId = START_MAP;
  phase = '';
  seq = 0;
  pending: UserCmd[] = [];
  sent: UserCmd[] = [];
  pred: PState = newPState();
  tmp: PState = newPState();
  predAlive = false;
  canMove = false;
  weapon = 1;
  clockOffset: number | null = null;
  latestTick = 0;
  yaw = 0;
  path: Array<[number, number]> | null = null;
  pathIdx = 0;
  goalAt = 0;
  stuckT = 0;
  lastPos: [number, number] = [0, 0];
  snapshots = new Map<number, Snapshot>();
  stats: Stats = { reconciles: 0, errs: [], smooth: 0, snaps: 0, snapGapMax: 0, snapGaps: 0, respawns: 0 };
  up = new LaggyPipe();
  down = new LaggyPipe();
  kicked = '';

  constructor(readonly name: string, readonly token: string) {}

  connect(): Promise<void> {
    return new Promise((ok, fail) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: `http://localhost:${PORT}` });
      this.ws.binaryType = 'arraybuffer';
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'auth', token: this.token }));
        ok();
      });
      this.ws.on('error', fail);
      this.ws.on('message', (data, isBinary) => {
        this.down.push(() => {
          if (isBinary) {
            const s = decodeSnapshot(data as ArrayBuffer);
            if (s) this.onSnapshot(s);
          } else this.onJson(JSON.parse(data.toString()));
        });
      });
    });
  }

  private onJson(m: any) {
    if (m.t === 'me') {
      if (this.spectator !== m.spectator) this.pending.length = 0;
      this.id = m.id;
      this.team = m.team;
      this.spectator = m.spectator;
    } else if (m.t === 'st') {
      this.phase = m.ph;
      if (m.map !== this.mapId) {
        this.mapId = m.map;
        this.path = null;
      }
    } else if (m.t === 'kick') this.kicked = m.msg;
  }

  private onSnapshot(s: Snapshot) {
    const nowT = (performance.now() / 1000) * TICK_RATE;
    const off = s.tick - nowT;
    if (this.clockOffset === null || Math.abs(off - this.clockOffset) > 32) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * (off > this.clockOffset ? 0.2 : 0.02);
    if (s.tick < this.latestTick) return;
    if (this.latestTick) {
      const gap = s.tick - this.latestTick;
      if (gap > this.stats.snapGapMax) this.stats.snapGapMax = gap;
      if (gap > 3) this.stats.snapGaps++;
    }
    this.latestTick = s.tick;
    this.stats.snaps++;
    this.snapshots.set(s.tick, s);
    if (this.snapshots.size > 400) this.snapshots.delete(this.snapshots.keys().next().value!);
    if (s.own.present) this.reconcile(s);
  }

  /** Та же логика, что в client/src/game/game.ts → reconcile(). */
  private reconcile(s: Snapshot) {
    const own = s.own;
    const alive = (own.flags & SF_ALIVE) !== 0;
    this.canMove = own.canMove;
    this.weapon = own.weapon;
    while (this.pending.length && this.pending[0].seq <= s.ackSeq) this.pending.shift();
    const st = this.tmp;
    st.x = own.x;
    st.y = own.y;
    st.z = own.z;
    st.vx = own.vx;
    st.vy = own.vy;
    st.vz = own.vz;
    st.onGround = (own.flags & SF_ONGROUND) !== 0;
    st.crouch = (own.flags & SF_CROUCH) !== 0;
    if (!alive) {
      copyPState(this.pred, st);
      this.predAlive = false;
      this.path = null;
      return;
    }
    const map = getMap(this.mapId).info.map;
    const speedMul = WEAPONS[own.weapon]?.speed ?? 1;
    for (const c of this.pending) stepPlayer(st, c.buttons, c.yaw, map, this.canMove, speedMul);
    if (this.predAlive) {
      const err = Math.hypot(this.pred.x - st.x, this.pred.y - st.y, this.pred.z - st.z);
      // в заморозке сервер ставит выжившего на точку появления — это телепорт, а не расхождение
      if (err > 1 && !own.canMove) {
        this.stats.respawns++;
        copyPState(this.pred, st);
        return;
      }
      this.stats.reconciles++;
      this.stats.errs.push(err);
      if (err > 0.01 && err <= 1) this.stats.smooth++;
    }
    copyPState(this.pred, st);
    this.predAlive = true;
  }

  serverTickNow() {
    return (performance.now() / 1000) * TICK_RATE + (this.clockOffset ?? 0);
  }

  /** Простое управление: идти по пути к центру карты, потом бродить вокруг него. */
  private steer(): number {
    if (!this.predAlive || !this.canMove) return 0;
    const { info, nav } = getMap(this.mapId);
    const now = performance.now();
    const moved = Math.hypot(this.pred.x - this.lastPos[0], this.pred.z - this.lastPos[1]);
    this.lastPos = [this.pred.x, this.pred.z];
    this.stuckT = moved < 0.01 ? this.stuckT + DT : 0;
    if (!this.path || this.pathIdx >= this.path.length || now > this.goalAt || this.stuckT > 1) {
      const [mx, mz] = info.mid;
      const pt = nav.randomIn(mx - 6, mz - 6, mx + 6, mz + 6, Math.random) ?? [mx, mz];
      this.path = nav.findPath(this.pred.x, this.pred.z, pt[0], pt[1]);
      this.pathIdx = 0;
      this.goalAt = now + 15000;
      this.stuckT = 0;
      if (!this.path) return 0;
    }
    let wp = this.path[this.pathIdx];
    while (Math.hypot(wp[0] - this.pred.x, wp[1] - this.pred.z) < 0.6 && this.pathIdx < this.path.length - 1) wp = this.path[++this.pathIdx];
    if (Math.hypot(wp[0] - this.pred.x, wp[1] - this.pred.z) < 0.6) {
      this.pathIdx++;
      return 0;
    }
    this.yaw = yawTo(wp[0] - this.pred.x, wp[1] - this.pred.z);
    // изредка стрейф, чтобы движение было не только по прямой
    return BTN_FWD | (Math.sin(now / 700 + this.id) > 0.85 ? BTN_RIGHT : 0);
  }

  tick() {
    if (this.spectator || this.ws.readyState !== WebSocket.OPEN) return;
    const buttons = this.steer();
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw: this.yaw, pitch: 0, slot: 1, viewTick: this.serverTickNow() - 0.1 * TICK_RATE };
    if (this.predAlive) {
      stepPlayer(this.pred, buttons, this.yaw, getMap(this.mapId).info.map, this.canMove, WEAPONS[this.weapon]?.speed ?? 1);
      this.pending.push(cmd);
      if (this.pending.length > 128) this.pending.shift();
    }
    this.sent.push(cmd);
    if (this.sent.length > 3) this.sent.shift();
    const pkt = encodeCmds(this.sent);
    this.up.push(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(pkt));
  }
}

async function api(path: string, body: object) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json() as Promise<any>;
}

function pct(a: number[], q: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

async function main() {
  // ждём сервер
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(BASE + '/healthz')).ok) break;
    } catch {
      /* ещё не поднялся */
    }
    if (i > 100) throw new Error('сервер не поднялся:\n' + serverLog);
    await sleep(200);
  }
  const clients: Client[] = [];
  for (let i = 0; i < 3; i++) {
    const login = `nc${i}_${Math.random().toString(36).slice(2, 8)}`;
    const r = await api('/api/register', { login, password: `Netcheck-${Math.random().toString(36).slice(2)}-Pw` });
    if (!r.token) throw new Error('регистрация: ' + JSON.stringify(r));
    clients.push(new Client(login, r.token));
  }
  for (const c of clients) await c.connect();

  console.log(`Сервер на порту ${PORT}, карта ${START_MAP}, задержка ${LATENCY}±${JITTER} мс в одну сторону, ${DURATION} с`);

  // 64 Гц, как в браузере: накопитель по реальному времени
  let acc = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    acc += (now - last) / 1000;
    last = now;
    let n = 0;
    while (acc >= DT && n < 16) {
      for (const c of clients) c.tick();
      acc -= DT;
      n++;
    }
    if (n === 16) acc = 0;
  }, 4);

  // Проверка видимости и совпадения позиций по снапшотам одного и того же тика
  let pairsChecked = 0,
    allyMissing = 0,
    enemyLos = 0,
    enemyMissing = 0,
    enemyLeak = 0,
    posErrMax = 0,
    seenEnemy = 0;
  const checked = new Set<string>();
  const checker = setInterval(() => {
    for (const a of clients) {
      for (const [tick, sa] of a.snapshots) {
        if (!sa.own.present || !(sa.own.flags & SF_ALIVE)) continue;
        for (const b of clients) {
          if (b === a || b.id < 0) continue;
          const key = `${a.name}:${b.name}:${tick}`;
          if (checked.has(key)) continue;
          const sb = b.snapshots.get(tick);
          if (!sb || !sb.own.present || !(sb.own.flags & SF_ALIVE)) continue;
          checked.add(key);
          pairsChecked++;
          const ent = sa.ents.find((e) => e.id === b.id);
          if (ent) posErrMax = Math.max(posErrMax, Math.hypot(ent.x - sb.own.x, ent.y - sb.own.y, ent.z - sb.own.z));
          if (a.team === b.team) {
            if (!ent) allyMissing++;
            continue;
          }
          // та же проверка, что Room.canSee на сервере (без дыма)
          const map = getMap(a.mapId).info.map;
          const ax = sa.own.x,
            ay = sa.own.y + eyeHeight({ crouch: (sa.own.flags & SF_CROUCH) !== 0 }),
            az = sa.own.z;
          const hh = sb.own.flags & SF_CROUCH ? 1.15 : 1.6;
          const d = Math.hypot(ax - sb.own.x, az - sb.own.z);
          const los = d < 3 || [hh, hh * 0.65, 0.3].some((h) => lineOfSight(map, ax, ay, az, sb.own.x, sb.own.y + h, sb.own.z));
          if (los) {
            enemyLos++;
            if (!ent) enemyMissing++;
          } else if (ent) enemyLeak++;
          if (ent) seenEnemy++;
        }
      }
    }
  }, 250);

  const t0 = Date.now();
  let lastReport = 0;
  while (Date.now() - t0 < DURATION * 1000) {
    await sleep(500);
    if (server.exitCode !== null) throw new Error('сервер упал:\n' + serverLog);
    const sec = Math.floor((Date.now() - t0) / 1000);
    if (sec - lastReport >= 15) {
      lastReport = sec;
      console.log(
        `  ${sec} с: ` +
          clients.map((c) => `${c.name} ${c.spectator ? 'наблюдает' : c.team === 0 ? 'T' : 'CT'} ${c.predAlive ? 'жив' : 'мёртв'} снапшотов ${c.stats.snaps}`).join(' | ') +
          ` | фаза ${clients[0].phase}`,
      );
    }
  }
  clearInterval(timer);
  clearInterval(checker);

  let ok = true;
  const fail = (msg: string) => {
    console.error('ОШИБКА: ' + msg);
    ok = false;
  };
  console.log('\nПредсказание своего движения:');
  for (const c of clients) {
    const e = c.stats.errs;
    const hard = e.filter((x) => x > 1).length;
    console.log(
      `  ${c.name} (${c.team === 0 ? 'T' : c.team === 1 ? 'CT' : '?'}): сверок ${c.stats.reconciles}, ошибка p50 ${(pct(e, 0.5) * 100).toFixed(2)} см, p99 ${(pct(e, 0.99) * 100).toFixed(2)} см, макс ${(Math.max(0, ...e) * 100).toFixed(1)} см; ` +
        `мягких поправок ${c.stats.smooth}, резких ${hard}, возвратов на точку появления ${c.stats.respawns}; снапшотов ${c.stats.snaps} (${(c.stats.snaps / DURATION).toFixed(1)}/с), макс. разрыв ${c.stats.snapGapMax} тиков, разрывов >3 тиков ${c.stats.snapGaps}` +
        (c.kicked ? `; кик: ${c.kicked}` : ''),
    );
    if (!c.stats.reconciles) fail(`${c.name} ни разу не сверился с сервером (не вошёл в игру?)`);
    if (c.stats.reconciles && c.stats.smooth / c.stats.reconciles > 0.05) fail(`${c.name}: больше 5% сверок с поправкой`);
    if (hard > 0) fail(`${c.name}: резкие поправки позиции больше 1 м`);
    if (c.stats.snaps < DURATION * 25) fail(`${c.name}: меньше 25 снапшотов в секунду`);
  }
  console.log('\nВидимость (снапшоты одного тика у двух живых клиентов):');
  console.log(`  пар проверено ${pairsChecked}; союзник пропал из снапшота ${allyMissing} раз`);
  console.log(`  враг на прямой видимости ${enemyLos} раз, из них не прислан ${enemyMissing}; прислан без видимости (упреждение) ${enemyLeak}; врага видели в снапшотах ${seenEnemy} раз`);
  console.log(`  расхождение позиции чужого игрока с его настоящей позицией: макс ${(posErrMax * 100).toFixed(2)} см`);
  if (!pairsChecked) fail('ни одной пары живых клиентов на одном тике');
  if (allyMissing) fail('союзник не прислан в снапшоте');
  if (enemyMissing) fail('враг на прямой видимости не прислан');
  if (posErrMax > 0.01) fail('позиция чужого игрока отличается от настоящей больше чем на 1 см');
  if (!enemyLos) console.warn('ВНИМАНИЕ: враги ни разу не оказались на прямой видимости — проверка врагов не состоялась, увеличьте время');

  for (const c of clients) c.ws.close();
  server.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
