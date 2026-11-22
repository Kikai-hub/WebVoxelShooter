// Автотест комнат и рейтинговых матчей без сети: поиск собирает матч союзников 2×2,
// игроки заходят (стоят на месте, играют за них боты соперника), матч доигрывается,
// проверяются Elo/звания, закрытие комнаты, лимит комнат и отмена брошенного матча.
// Запуск: npm run test:ranked

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ROOMS, type ServerMsg } from '../shared/src/index';
import { AccountStore } from '../server/src/accounts';
import { DEFAULT_LOADOUT, type Conn } from '../server/src/room';
import { RoomManager } from '../server/src/rooms';

const dir = mkdtempSync(join(tmpdir(), 'vts-ranked-'));
let ok = true;
const check = (cond: boolean, what: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
  if (!cond) ok = false;
};

async function main() {
  const accounts = new AccountStore(dir);
  const rm = new RoomManager(accounts, 'medium', 20);
  const mm = (rm as any).matchmake.bind(rm) as () => void;
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await accounts.register(`tester${i}`, 'password123', '127.0.0.' + i);
    if ('error' in r) throw new Error(r.error);
    ids.push(r.account.id);
  }
  const inbox = new Map<string, ServerMsg[]>();
  let connId = 1;
  const conn = (acc: string): Conn => {
    inbox.set(acc, []);
    return {
      id: connId++,
      accountId: acc,
      login: accounts.get(acc)!.login,
      loadout: DEFAULT_LOADOUT,
      slot: -1,
      pendingSlot: -1,
      lastChat: -10,
      sendJson: (m) => inbox.get(acc)!.push(m),
      sendBin: () => {},
      buffered: () => 0,
      close: () => {},
    };
  };

  // 1. Комнаты не создаются заранее
  check(rm.rooms.size === 0, 'на старте нет ни одной комнаты');

  // 2. Поиск союзников: трое — матча нет, четвёртый — матч
  for (let i = 0; i < 3; i++) rm.enqueue([{ accountId: ids[i], login: 'p' + i }], 'wm');
  mm();
  check(rm.rooms.size === 0 && rm.queueState(ids[0]).state === 'searching', 'трое в поиске 2×2 — матч не собран');
  rm.enqueue([{ accountId: ids[3], login: 'p3' }], 'wm');
  mm();
  const room = [...rm.rooms.values()][0];
  check(rm.rooms.size === 1 && room?.mode === 'wm' && room.players.length === 4 && room.half === 8, 'четвёртый игрок — создана комната 2×2 (4 места, половина 8 раундов)');
  check(ids.slice(0, 4).every((id) => rm.queueState(id).state === 'found'), 'всем четверым поиск отвечает «матч найден»');

  // 3. Чужой не войдёт в рейтинговый матч, свои — на свои места
  check(typeof rm.route(ids[4], 'wm') === 'string', 'игрок не из матча не попадает в рейтинговую комнату');
  const conns = ids.slice(0, 4).map((id) => {
    const c = conn(id);
    const r = rm.route(id, 'wm');
    if (typeof r !== 'string') r.join(c);
    return c;
  });
  check(room.players.filter((p) => !p.isBot).length === 4, 'все четверо заняли свои места');
  // один уходит навсегда — его место займёт бот, ему засчитают поражение
  room.leave(conns[3]);

  // 4. Доигрываем матч
  let guard = 0;
  let rkLive = false,
    rkEnd = false;
  while (!room.closed && guard++ < 64 * 60 * 60 * 2) {
    room.step();
    if (guard % 64 === 0 || room.phase === 'matchEnd') {
      const st = room.publicState(-2);
      const has = st.pl.some((p) => p.rk);
      if (room.phase === 'live' && has) rkLive = true;
      if (room.phase === 'matchEnd' && has) rkEnd = true;
    }
  }
  check(!rkLive && rkEnd, 'звания в таблице скрыты во время игры и видны после конца матча');
  check(room.closed, `матч доигран и комната закрыта (счёт ${room.scores[0]}:${room.scores[1]})`);
  const ratingMsgs = ids.slice(0, 3).map((id) => inbox.get(id)!.find((m) => m.t === 'rating'));
  check(ratingMsgs.every(Boolean), 'оставшиеся игроки получили итог матча');
  for (const m of ratingMsgs) if (m && m.t === 'rating') console.log('     ', m.won ? 'победа' : 'поражение', m.delta, m.rank, m.promo ?? '');
  const leaver = accounts.ratings(accounts.get(ids[3])!).wm;
  check(leaver.matches === 1 && leaver.wins === 0 && leaver.mmr < 1000, `ушедший получил поражение (рейтинг ${leaver.mmr})`);
  check(ids.slice(0, 4).every((id) => accounts.ratings(accounts.get(id)!).wm.rank === null), 'после 1 матча звание ещё не выдано (калибровка)');
  check(inbox.get(ids[0])!.some((m) => m.t === 'kick' && m.end), 'игроков вернуло в меню');
  const top = accounts.top('wm', 50);
  check(top.list.length === 0, 'до 5 матчей союзников никого нет в рейтинге союзников');
  rm.step();
  check(rm.rooms.size === 0 && rm.queueState(ids[0]).state === 'idle', 'закрытая комната удалена, можно искать снова');

  // 5. Паблик создаётся при входе и только один, пока в нём есть места
  const a = rm.route(ids[4], 'public');
  const b = rm.route(ids[5], 'public');
  check(typeof a !== 'string' && a === b && rm.rooms.size === 1, 'паблик создан по первому входу, второй игрок — в тот же');
  check(typeof a !== 'string' && a.rankOf === null, 'в паблике звания в таблице не показываются');
  if (typeof a !== 'string') {
    a.join(conn(ids[4]));
    a.join(conn(ids[5]));
  }

  // 6. Лимит комнат
  for (let i = 0; i < MAX_ROOMS + 5; i++) (rm as any).create('public');
  check(rm.rooms.size > MAX_ROOMS, '(служебно наполнили комнаты сверх лимита)');
  for (const [id, r] of rm.rooms) if (rm.rooms.size > MAX_ROOMS && r !== a) rm.rooms.delete(id);
  for (const r of rm.rooms.values()) for (const p of r.players) if (r !== a) p.pending = {} as Conn; // занять все места у ботов
  for (let i = 0; i < 2; i++) rm.enqueue([{ accountId: ids[i], login: 'x' }], 'wm');
  for (let i = 2; i < 4; i++) rm.enqueue([{ accountId: ids[i], login: 'x' }], 'wm');
  mm();
  check(rm.rooms.size === MAX_ROOMS && rm.queueState(ids[0]).full === true, `при ${MAX_ROOMS} комнатах новый матч не создаётся, поиск ждёт`);

  // 7. Брошенный рейтинговый матч отменяется без изменения рейтинга
  rm.rooms.clear();
  mm();
  const r2 = [...rm.rooms.values()][0];
  const before = accounts.ratings(accounts.get(ids[0])!).wm.mmr;
  for (let i = 0; i < 64 * 95; i++) r2.step();
  check(r2.closed && accounts.ratings(accounts.get(ids[0])!).wm.mmr === before, 'никто не зашёл за 90 с — матч отменён, рейтинг не изменился');

  accounts.flush();
  rmSync(dir, { recursive: true, force: true });
  console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
  process.exit(ok ? 0 : 1);
}
void main();
