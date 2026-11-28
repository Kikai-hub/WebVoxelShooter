// Автотест комнат и рейтинговых матчей без сети: поиск собирает матч союзников 2×2,
// игроки заходят с задержкой (разминка → отсчёт → матч; стоят на месте, играют за них боты соперника),
// матч доигрывается, проверяются сброс после разминки, Elo/звания, закрытие комнаты,
// лимит комнат, отмена брошенного матча и разминка, на которую пришли не все.
// Запуск: npm run test:ranked

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_MONEY, MAX_ROOMS, START_MONEY, TICK_RATE, type GameEvent, type ServerMsg } from '../shared/src/index';
import { AccountStore } from '../server/src/accounts';
import { COUNTDOWN_TIME, DEFAULT_LOADOUT, type Conn, type Room } from '../server/src/room';
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
  const join = (id: string) => {
    const c = conn(id);
    const r = rm.route(id, 'wm');
    if (typeof r !== 'string') r.join(c);
    return c;
  };
  const steps = (r: Room, sec: number) => {
    for (let i = 0; i < Math.round(sec * TICK_RATE); i++) r.step();
  };
  const events = (acc: string): GameEvent[] => inbox.get(acc)!.flatMap((m) => (m.t === 'ev' ? m.e : []));
  const slotOf = (r: Room, id: string) => r.players[r.roster!.indexOf(id)];
  const statsOf = (id: string) => accounts.get(id)!.stats;
  const zeroStats = (id: string) => {
    const st = statsOf(id);
    return !st || (st.kills === 0 && st.deaths === 0 && st.assists === 0 && st.damage === 0 && st.shots === 0 && st.rounds === 0 && st.mvps === 0 && st.playSeconds === 0);
  };

  // 3а. Разминка: матч начинается не сразу, первые двое уже бегают и стреляют
  check(room.phase === 'warmup' && room.bomb.status === 'none' && room.players.every((p) => p.alive && !p.hasBomb), 'рейтинговая комната стартует в разминке: все на поле, бомбы нет');
  const conns = [join(ids[0]), join(ids[1])];
  steps(room, 20);
  check(room.phase === 'warmup', 'двое из четырёх — разминка продолжается');
  const st0 = room.publicState(0);
  check(st0.ph === 'warmup' && st0.wu?.[0] === 2 && st0.wu?.[1] === 4 && st0.sc[0] === 0 && st0.sc[1] === 0, `в состоянии комнаты — «ждём игроков ${st0.wu?.[0]}/${st0.wu?.[1]}»`);
  const p0 = slotOf(room, ids[0]);
  // покупка без трат, в любое время
  if (!p0.alive) steps(room, 2.1);
  const bought = room.buy(p0, 'awm') && room.buy(p0, 'helmet') && room.buy(p0, 'he');
  check(bought && p0.money === MAX_MONEY && p0.primary?.def.key === 'awm', `покупка в разминке без трат (AWM, броня, граната — денег $${p0.money})`);
  // стоящих людей убивают боты — через 2 с они снова на поле
  let died = 0,
    respawned = 0,
    botDeaths = 0;
  const deadAt = new Map<number, number>();
  for (let i = 0; i < 64 * 40; i++) {
    room.step();
    for (const p of room.players) {
      if (!p.alive && !deadAt.has(p.id)) {
        deadAt.set(p.id, room.time);
        died++;
        if (p.isBot) botDeaths++;
      } else if (p.alive && deadAt.has(p.id)) {
        if (room.time - deadAt.get(p.id)! >= 1.9) respawned++;
        deadAt.delete(p.id);
      }
    }
  }
  check(died > 0 && respawned > 0, `в разминке убивают и возрождают через 2 с (смертей ${died}, ботов ${botDeaths}, возрождений ${respawned})`);
  check(events(ids[0]).some((e) => e.e === 'kill') && events(ids[0]).some((e) => e.e === 'respawn'), 'клиенту приходят убийства и возрождения');
  check(room.phase === 'warmup' && room.bomb.status === 'none' && room.players.every((p) => !p.hasBomb), 'в разминке бомба не выдаётся');
  check(zeroStats(ids[0]) && zeroStats(ids[1]), 'убийства, урон, выстрелы и время разминки не попали в статистику аккаунта');
  check(!events(ids[0]).some((e) => e.e === 'roundStart' || e.e === 'announce'), 'в разминке нет начала раунда (звука начала матча) и комментатора');
  // переподключение в разминке: место и разминка сохраняются
  room.leave(conns[1]);
  steps(room, 3);
  conns[1] = join(ids[1]);
  check(room.phase === 'warmup' && !slotOf(room, ids[1]).isBot && slotOf(room, ids[1]).conn === conns[1], 'вышел и вернулся в разминке — своё место, разминка идёт');
  // третий и четвёртый — с задержкой
  conns.push(join(ids[2]));
  steps(room, 5);
  check(room.phase === 'warmup' && room.publicState(0).wu?.[0] === 3, 'трое из четырёх — всё ещё разминка');
  conns.push(join(ids[3]));
  room.step();
  check(room.phase === 'countdown' && Math.abs(room.phaseEnd - room.time - COUNTDOWN_TIME) < 0.1, `пришли все — отсчёт ${COUNTDOWN_TIME} с до начала матча`);
  const moveFrom = slotOf(room, ids[3]).st.z;
  // в отсчёте можно бегать и стрелять (покупка тоже бесплатна)
  check(room.canBuy(slotOf(room, ids[3])) && room.publicState(0).ph === 'countdown', 'в отсчёте можно покупать, состояние — «Матч начнётся через N»');
  steps(room, COUNTDOWN_TIME - 1);
  check(room.phase === 'countdown', 'отсчёт ещё идёт');
  void moveFrom;
  steps(room, 1.1);
  // 3б. Полный сброс после разминки
  const humans = ids.slice(0, 4).map((id) => slotOf(room, id));
  check(room.phase === 'freeze' && room.roundNum === 1 && room.scores[0] === 0 && room.scores[1] === 0, 'после отсчёта — заморозка первого раунда, счёт 0:0');
  check(room.players.every((p) => p.kills === 0 && p.deaths === 0 && p.assists === 0), 'убийства, смерти и помощь в таблице обнулены');
  check(humans.every((p) => p.money === START_MONEY && !p.primary && p.armor === 0 && p.nades.every((n) => n === 0) && p.alive), `деньги ($${START_MONEY}), оружие, броня и гранаты сброшены`);
  check(room.bomb.status === 'carried' && room.players.filter((p) => p.hasBomb).length === 1, 'в первом раунде бомба выдана нападению');
  const rs = events(ids[0]).filter((e) => e.e === 'roundStart');
  check(rs.length === 1 && rs[0].e === 'roundStart' && rs[0].rn === 1, 'начало матча (раунд 1) объявлено один раз — звук начала матча прозвучит после разминки');
  check(zeroStats(ids[0]) && zeroStats(ids[3]), 'к началу матча статистика аккаунтов не изменилась');
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
  {
    const st = statsOf(ids[0])!;
    const rounds = room.scores[0] + room.scores[1];
    check(st.matches === 1 && st.rounds === rounds && accounts.ratings(accounts.get(ids[0])!).wm.matches === 1, `в статистику и рейтинг вошёл только сам матч (матчей ${st.matches}, раундов ${st.rounds} из ${rounds})`);
  }
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

  // 8. Разминка, на которую пришли не все: по окончании времени — отсчёт и матч с ботом на пустом месте
  rm.step();
  process.env.RANKED_WARMUP = '30';
  for (let i = 0; i < 4; i++) rm.enqueue([{ accountId: ids[i], login: 'p' + i }], 'wm');
  mm();
  delete process.env.RANKED_WARMUP;
  const r3 = [...rm.rooms.values()].find((r) => r !== r2 && !r.closed)!;
  check(!!r3 && r3.phase === 'warmup' && r3.warmupTime === 30, 'новый матч союзников — разминка (сокращена до 30 с для теста)');
  if (r3) {
    const absent = ids[3];
    for (const id of ids.slice(0, 3)) join(id);
    steps(r3, 29);
    check(r3.phase === 'warmup' && r3.publicState(0).wu?.[0] === 3, 'трое из четырёх, время не вышло — разминка');
    steps(r3, 1.1);
    check(r3.phase === 'countdown', 'время разминки вышло — отсчёт, хотя пришли не все');
    check(events(ids[0]).some((e) => e.e === 'info' && /Не все подключились/.test(e.text)), 'игроков предупредили, что пустое место займёт бот');
    steps(r3, COUNTDOWN_TIME + 0.1);
    check(r3.phase === 'freeze' && r3.roundNum === 1 && r3.scores[0] === 0 && r3.scores[1] === 0, 'матч начался: заморозка первого раунда, 0:0');
    check(slotOf(r3, absent).isBot && ids.slice(0, 3).every((id) => !slotOf(r3, id).isBot), 'на месте не пришедшего — бот, остальные на своих местах');
    // опоздавший всё ещё может войти на своё место (в заморозке — сразу)
    join(absent);
    check(!slotOf(r3, absent).isBot && slotOf(r3, absent).accountId === absent, 'опоздавший после разминки заходит на своё место');
    r3.close('конец теста');
  }

  accounts.flush();
  rmSync(dir, { recursive: true, force: true });
  console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
  process.exit(ok ? 0 : 1);
}
void main();
