// Сквозной тест лобби на настоящем сервере: 10 тестовых аккаунтов, два лобби по 5 (A и B).
//  1) лобби собираются по приглашениям (онлайн, принять, отклонить);
//  2) паблик: лидер запускает — участники видят его комнату, все 10 подключаются по WebSocket,
//     каждое лобби целиком в одной команде;
//  3) матчмейкинг 5×5: лидеры ставят лобби в поиск — участники видят поиск своей группы,
//     матч собирается, все 10 подключаются, A и B — в разных командах, лобби не разорваны;
//  4) союзники 2×2: в лобби из 5 поиск запрещён; два лобби по двое находят матч, все четверо в игре;
//  5) отмена поиска участником отменяет поиск всей группы.
// Сервер поднимается с TRUST_PROXY=1: у каждого игрока свой адрес (X-Forwarded-For) —
// иначе сработали бы лимиты регистраций и подключений с одного IP.
// Запуск: npm run test:lobby

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { RoomState } from '../shared/src/index';

const PORT = 9000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'vts-lobby-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/main.ts'], {
  env: { ...process.env, GAME_PORT: String(PORT), DATA_DIR: dataDir, TRUST_PROXY: '1', RANKED_ABANDON: '3', RANKED_BOT_FILL: '0', BOT_LEVEL: 'easy' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond: boolean, what: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
  if (!cond) ok = false;
};

interface Player {
  login: string;
  token: string;
  ip: string;
}

async function api(p: Player | null, path: string, method = 'GET', body?: object, ip = p?.ip ?? '10.9.9.9'): Promise<any> {
  const res = await fetch(`${BASE}/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(p ? { authorization: 'Bearer ' + p.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

/** Подключиться к игре как браузер: auth с режимом и комнатой; ждём полное состояние и состояние комнаты. */
function connect(p: Player, mode: string, room?: string): Promise<{ slot: number; team: number; roomMode: string; map: string; ws: WebSocket; kick?: string; av: Record<number, string> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': p.ip } });
    let slot = -2;
    const av: Record<number, string> = {};
    const done = (r: { slot: number; team: number; roomMode: string; map: string; kick?: string }) => {
      clearTimeout(timer);
      resolve({ ...r, ws, av });
    };
    const timer = setTimeout(() => done({ slot, team: -1, roomMode: '', map: '', kick: 'timeout' }), 8000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token: p.token, mode, ...(room ? { room } : {}) })));
    ws.on('message', (data, bin) => {
      if (bin) return;
      const m = JSON.parse(data.toString());
      if (m.t === 'kick') done({ slot: -1, team: -1, roomMode: '', map: '', kick: m.msg });
      if (m.t === 'full') slot = m.you;
      if (m.t === 'av') Object.assign(av, m.a);
      if (m.t === 'st' && slot !== -2) {
        const st = m as RoomState;
        // игрок в слоте (или ждёт места — тогда команда по слоту ожидания неизвестна)
        const me = st.pl.find((q) => q.i === slot);
        done({ slot, team: me ? me.t : -1, roomMode: st.mode, map: st.map });
      }
    });
    ws.on('error', () => done({ slot: -1, team: -1, roomMode: '', map: '', kick: 'ws error' }));
  });
}

async function main() {
  // сервер поднялся?
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) break;
    } catch {
      /* ещё стартует */
    }
    await sleep(200);
  }

  // ---- 10 аккаунтов ----
  const players: Player[] = [];
  for (let i = 0; i < 10; i++) {
    const ip = `10.77.0.${i + 1}`;
    const r = await api(null, 'register', 'POST', { login: `lobby_t${i}`, password: 'test-pass-' + i }, ip);
    if (!r.token) throw new Error('регистрация: ' + r.error);
    players.push({ login: `lobby_t${i}`, token: r.token, ip });
  }
  check(players.length === 10, 'создано 10 тестовых аккаунтов');
  const A = players.slice(0, 5),
    B = players.slice(5, 10);
  // все «в меню» — онлайн
  for (const p of players) await api(p, 'party');

  // ---- лобби по приглашениям ----
  const form = async (lobby: Player[]) => {
    const [lead, ...rest] = lobby;
    for (const m of rest) {
      const inv = await api(lead, 'party/invite', 'POST', { login: m.login });
      if (inv.status !== 200) throw new Error('приглашение: ' + inv.error);
      const st = await api(m, 'party');
      const id = st.invites.find((x: any) => x.from === lead.login)?.id;
      const acc = await api(m, 'party/accept', 'POST', { id });
      if (acc.status !== 200) throw new Error('принять: ' + acc.error);
    }
  };
  // одно отклонение до сбора: B0 зовёт A1, тот отклоняет
  await api(B[0], 'party/invite', 'POST', { login: A[1].login });
  const invA1 = (await api(A[1], 'party')).invites[0];
  await api(A[1], 'party/decline', 'POST', { id: invA1.id });
  check((await api(A[1], 'party')).invites.length === 0, 'приглашение отклонено и пропало');
  await form(A);
  await form(B);
  const pa = await api(A[3], 'party'),
    pb = await api(B[2], 'party');
  check(pa.party?.members.length === 5 && pa.party.leader === A[0].login && !pa.leader, 'лобби A: 5 игроков, лидер A0, участник видит, что он не лидер');
  check(pb.party?.members.length === 5 && pb.party.leader === B[0].login, 'лобби B: 5 игроков, лидер B0');
  check((await api(A[0], 'party/invite', 'POST', { login: B[1].login })).status === 400, 'в полное лобби (5) больше не пригласить');
  check((await api(A[2], 'queue', 'POST', { mode: 'mm' })).status === 403, 'поиск запускает только лидер');

  // ---- аватарка ----
  // минимальный «JPEG»: маркеры начала и конца, внутри — нули (сервер проверяет маркеры и размер)
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400), Buffer.from([0xff, 0xd9])]);
  const up = await api(A[0], 'avatar', 'POST', { data: 'data:image/jpeg;base64,' + jpeg.toString('base64') });
  check(up.status === 200 && /^\/api\/avatar\/[a-f0-9]{24}\.jpg$/.test(up.avatar), 'аватарка загружена');
  const png = await api(A[1], 'avatar', 'POST', { data: 'data:image/png;base64,iVBORw0KGgo=' });
  check(png.status === 400, 'не-JPEG не принимается');
  const fake = await api(A[1], 'avatar', 'POST', { data: 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>'.repeat(10)).toString('base64') });
  check(fake.status === 400, 'подделка под JPEG не принимается');
  const img = await fetch(BASE + up.avatar);
  check(img.ok && img.headers.get('content-type') === 'image/jpeg' && (await img.arrayBuffer()).byteLength === jpeg.length, 'картинку видно всем (без входа)');
  const trav = await Promise.all(['/api/avatar/..%2Faccounts.json', '/api/avatar/..%2F..%2Fdata%2Faccounts.json', '/api/avatar/' + 'a'.repeat(23) + '.jpg'].map((p) => fetch(BASE + p).then((r) => r.status)));
  check(trav.every((s) => s !== 200), `через адрес аватарки к другим файлам не пробраться (${trav.join(', ')})`);

  // ---- паблик ----
  const goA = await api(A[0], 'party/play', 'POST', {});
  check(!!goA.room, `лидер A запустил паблик: комната ${goA.room}`);
  const seenA = await Promise.all(A.slice(1).map((m) => api(m, 'party')));
  check(seenA.every((s) => s.party?.go?.room === goA.room), 'участники A видят комнату лидера');
  const connA = await Promise.all(A.map((p) => connect(p, 'public', goA.room)));
  const goB = await api(B[0], 'party/play', 'POST', {});
  const connB = await Promise.all(B.map((p) => connect(p, 'public', goB.room)));
  check(connA.every((c) => !c.kick && c.slot >= 0 && c.roomMode === 'public'), 'паблик: все 5 из A подключились и играют');
  check(connB.every((c) => !c.kick && c.slot >= 0 && c.roomMode === 'public'), `паблик: все 5 из B подключились и играют (комната ${goB.room})`);
  check(new Set(connA.map((c) => c.team)).size === 1, 'паблик: лобби A целиком в одной команде');
  check(connA[4].av[connA[0].slot] === up.avatar, 'аватарка A0 пришла другим игрокам в комнате');
  check((await api(A[2], 'party')).party.members.find((m: any) => m.login === A[0].login)?.avatar === up.avatar, 'аватарка видна в лобби');
  check(new Set(connB.map((c) => c.team)).size === 1, 'паблик: лобби B целиком в одной команде');
  if (goA.room === goB.room) check(connA[0].team !== connB[0].team, 'паблик: A и B в одной комнате — в разных командах');
  for (const c of [...connA, ...connB]) c.ws.close();
  await sleep(500);

  // ---- матчмейкинг 5×5: два лобби по 5 ----
  const qa = await api(A[0], 'queue', 'POST', { mode: 'mm' });
  check(qa.state === 'searching' && qa.party === 5, 'лобби A в поиске матчмейкинга (группа из 5)');
  const memberSees = await api(A[4], 'party');
  check(memberSees.queue.state === 'searching' && memberSees.queue.mode === 'mm', 'участник A видит поиск своей группы');
  await api(B[0], 'queue', 'POST', { mode: 'mm' });
  // поиск раз в секунду; участники «спрашивают» очередь, как меню
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    await sleep(500);
    const states = await Promise.all(players.map((p) => api(p, 'queue')));
    found = states.every((s) => s.state === 'found' && s.mode === 'mm');
  }
  check(found, 'матчмейкинг: матч найден для всех 10');
  const connM = await Promise.all(players.map((p) => connect(p, 'mm')));
  check(connM.every((c) => !c.kick && c.slot >= 0 && c.roomMode === 'mm'), 'матчмейкинг: все 10 подключились к рейтинговой комнате');
  const tA = new Set(connM.slice(0, 5).map((c) => c.team)),
    tB = new Set(connM.slice(5).map((c) => c.team));
  check(tA.size === 1 && tB.size === 1 && [...tA][0] !== [...tB][0], 'матчмейкинг: лобби A и B — каждое в своей команде');
  // чужой в рейтинговую комнату не войдёт
  const outsiderIp = '10.77.1.1';
  const out = await api(null, 'register', 'POST', { login: 'lobby_out', password: 'test-pass-x' }, outsiderIp);
  const outsider: Player = { login: 'lobby_out', token: out.token, ip: outsiderIp };
  const outConn = await connect(outsider, 'mm');
  check(!!outConn.kick, `посторонний в рейтинговый матч не попадает («${outConn.kick}»)`);
  for (const c of [...connM, outConn]) c.ws.close();
  // ждём отмены брошенного матча (RANKED_ABANDON=3 с)
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if ((await api(A[0], 'queue')).state === 'idle') break;
  }
  check((await api(A[0], 'queue')).state === 'idle', 'брошенный матч отменён — можно искать снова');

  // ---- союзники 2×2 ----
  check((await api(A[0], 'queue', 'POST', { mode: 'wm' })).status === 400, 'союзники: лобби из 5 в поиск не пускает');
  // распускаем лобби, собираем два дуэта: A0+A1 и B0+B1
  for (const p of players) await api(p, 'party/leave', 'POST', {});
  for (const p of players) await api(p, 'party');
  await form([A[0], A[1]]);
  await form([B[0], B[1]]);
  await api(A[0], 'queue', 'POST', { mode: 'wm' });
  await api(B[0], 'queue', 'POST', { mode: 'wm' });
  const duo = [A[0], A[1], B[0], B[1]];
  let wmFound = false;
  for (let i = 0; i < 20 && !wmFound; i++) {
    await sleep(500);
    const states = await Promise.all(duo.map((p) => api(p, 'queue')));
    wmFound = states.every((s) => s.state === 'found' && s.mode === 'wm');
  }
  check(wmFound, 'союзники: матч 2×2 найден для обоих дуэтов');
  const connW = await Promise.all(duo.map((p) => connect(p, 'wm')));
  check(connW.every((c) => !c.kick && c.slot >= 0 && c.roomMode === 'wm' && c.map.startsWith('wm_')), `союзники: все четверо в игре на карте 2×2 (${connW[0].map})`);
  check(connW[0].team === connW[1].team && connW[2].team === connW[3].team && connW[0].team !== connW[2].team, 'союзники: каждый дуэт в своей команде');
  for (const c of connW) c.ws.close();

  // ---- отмена поиска участником ----
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if ((await api(A[0], 'queue')).state === 'idle') break;
  }
  await api(A[0], 'queue', 'POST', { mode: 'wm' });
  await api(A[1], 'queue', 'DELETE');
  check((await api(A[0], 'queue')).state === 'idle', 'участник отменил поиск — отменился у всей группы');

  // ---- удаление аватарки ----
  await api(A[0], 'avatar', 'DELETE');
  check((await fetch(BASE + up.avatar)).status === 404 && (await api(A[0], 'me')).account.avatar === null, 'аватарка удалена вместе с файлом');

  console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
}

main()
  .catch((e) => {
    ok = false;
    console.error('ОШИБКА ТЕСТА:', e);
  })
  .finally(() => {
    server.kill();
    setTimeout(() => {
      rmSync(dataDir, { recursive: true, force: true });
      if (!ok) console.log('--- лог сервера ---\n' + serverLog.split('\n').slice(-30).join('\n'));
      process.exit(ok ? 0 : 1);
    }, 300);
  });
