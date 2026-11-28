// Паттерны отдачи: рисунок очереди на стене и проверка, что номер выстрела в серии
// у клиента и сервера совпадает при задержке, дрожании сети и выброшенных командах.
// Запуск: npm run test:spray -- [ключ оружия, например vikhr]

import {
  WEAPONS,
  newSpray,
  sprayTick,
  sprayFire,
  spraySync,
  sprayKick,
  type SprayState,
  type WeaponDef,
  TICK_RATE,
} from '../shared/src/index';

// ---------- 1. Рисунок: следы полной очереди на стене в 10 м (без случайного разброса) ----------

function drawPattern(def: WeaponDef) {
  const W = 41,
    H = 22,
    cell = 0.05; // 5 см на символ
  const grid = Array.from({ length: H }, () => Array<string>(W).fill('·'));
  const s = newSpray();
  const shots = def.mag;
  const ticksPer = Math.ceil(def.interval * TICK_RATE);
  let n = 0;
  for (let t = 0; n < shots; t++) {
    sprayTick(s);
    if (t % ticksPer === 0) {
      const i = sprayFire(s);
      const [r, u] = sprayKick(def, i);
      const x = Math.round((Math.tan(r) * 10) / cell) + (W >> 1);
      const y = H - 2 - Math.round((Math.tan(u) * 10) / cell);
      if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = n < 9 ? String(n + 1) : n < 35 ? String.fromCharCode(97 + n - 9) : '#';
      n++;
    }
  }
  console.log(`\n${def.name} (${def.key}), ${shots} выстрелов, стена 10 м, клетка 5 см; 1–9, затем a–z — порядок пуль:`);
  for (const row of grid) console.log('  ' + row.join(''));
}

const only = process.argv[2];
for (const def of WEAPONS) if (def.pattern.length && (!only || def.key === only)) drawPattern(def);
console.log('\nБез паттерна (старая модель — растущий круг):', WEAPONS.filter((w) => !w.pattern.length && w.kind !== 'grenade' && w.kind !== 'knife').map((w) => w.key).join(', '));

// ---------- 2. Синхронизация клиент/сервер ----------

let rng = 12345;
const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

interface Scenario {
  name: string;
  /** задержка в одну сторону, тиков: база ± дрожание (порядок сохраняется — это TCP) */
  lat: number;
  jitter: number;
  /** вероятность на тик, что сервер выбросит пачку команд (переполненная очередь после лага) */
  dropChance: number;
  /** вероятность, что сервер откажет в выстреле, который клиент предсказал (магазин, перезарядка) */
  refuseChance: number;
}

function simulate(sc: Scenario) {
  const T = TICK_RATE * 120;
  const client = newSpray();
  const server = newSpray();
  const fired = new Set<number>();
  const pending: number[] = [];
  const toServer: { at: number; seq: number; fire: boolean }[] = [];
  const toClient: { at: number; ack: number; idx: number; idle: number }[] = [];
  const cIdx = new Map<number, number>();
  const sIdx = new Map<number, number>();
  let lastArrive = 0,
    lastSnapArrive = 0;
  let fireUntil = 0,
    pauseUntil = 0;
  let ack = 0;
  for (let tick = 1; tick <= T; tick++) {
    // клиент: очереди разной длины с паузами
    if (tick >= pauseUntil && tick >= fireUntil) {
      fireUntil = tick + 1 + Math.floor(rnd() * 160);
      pauseUntil = fireUntil + Math.floor(rnd() * 60);
    }
    const wantFire = tick < fireUntil && tick % 7 === 0; // ~0.1 с между выстрелами
    const seq = tick;
    sprayTick(client);
    if (wantFire) {
      cIdx.set(seq, sprayFire(client));
      fired.add(seq);
    }
    pending.push(seq);
    lastArrive = Math.max(lastArrive, tick + sc.lat + Math.round((rnd() * 2 - 1) * sc.jitter));
    toServer.push({ at: lastArrive, seq, fire: wantFire });
    // сервер: применяет пришедшие команды
    const drop = rnd() < sc.dropChance;
    let dropped = drop ? 2 + Math.floor(rnd() * 12) : 0;
    while (toServer.length && toServer[0].at <= tick) {
      const c = toServer.shift()!;
      if (dropped > 0) {
        dropped--;
        continue;
      }
      ack = c.seq;
      sprayTick(server);
      if (c.fire && rnd() >= sc.refuseChance) sIdx.set(c.seq, sprayFire(server));
    }
    // снапшот 30 Гц ≈ каждые 2 тика
    if (tick % 2 === 0) {
      lastSnapArrive = Math.max(lastSnapArrive, tick + sc.lat + Math.round((rnd() * 2 - 1) * sc.jitter));
      toClient.push({ at: lastSnapArrive, ack, idx: server.idx, idle: server.idle });
    }
    while (toClient.length && toClient[0].at <= tick) {
      const sn = toClient.shift()!;
      while (pending.length && pending[0] <= sn.ack) pending.shift();
      for (const q of fired) if (q <= sn.ack) fired.delete(q);
      spraySync(client, sn.idx, sn.idle, pending, fired);
    }
  }
  let both = 0,
    same = 0;
  for (const [seq, si] of sIdx) {
    const ci = cIdx.get(seq);
    if (ci === undefined) continue;
    both++;
    if (ci === si) same++;
  }
  const pct = ((same / Math.max(1, both)) * 100).toFixed(2);
  console.log(`  ${sc.name}: выстрелов у обоих ${both}, номер совпал ${same} (${pct}%)`);
  return same / Math.max(1, both);
}

console.log('\nСинхронизация номера выстрела (2 минуты очередей на сценарий):');
const perfect = simulate({ name: 'задержка 40±20 мс', lat: 3, jitter: 1, dropChance: 0, refuseChance: 0 });
const lag = simulate({ name: 'задержка 150±60 мс', lat: 10, jitter: 4, dropChance: 0, refuseChance: 0 });
const bad = simulate({ name: '100±40 мс, сервер выбрасывает пачки команд и иногда не даёт выстрелить', lat: 6, jitter: 3, dropChance: 0.004, refuseChance: 0.02 });
let ok = true;
if (perfect < 1 || lag < 1) {
  console.error('ОШИБКА: без потерь номера выстрела должны совпадать всегда');
  ok = false;
}
if (bad < 0.9) {
  console.error('ОШИБКА: после расхождений клиент не выравнивается по серверу');
  ok = false;
}
process.exit(ok ? 0 : 1);
