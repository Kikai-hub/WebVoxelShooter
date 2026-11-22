// Автотест смены сторон: после половины матча у игроков не остаётся гранат, оружия, брони и набора
// с прошлой стороны — во всех режимах; в рейтинговых сменить команду вручную нельзя.
// Запуск: npm run test:sides

import { HALF_ROUNDS, WINGMAN_HALF, type ServerMsg } from '../shared/src/index';
import { DEFAULT_LOADOUT, Room, type Conn } from '../server/src/room';

let ok = true;
const check = (cond: boolean, what: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
  if (!cond) ok = false;
};
const conn = (id: string, inbox: ServerMsg[]): Conn => ({
  id: Math.floor(Math.random() * 1e9),
  accountId: id,
  login: id,
  loadout: DEFAULT_LOADOUT,
  slot: -1,
  pendingSlot: -1,
  lastChat: -10,
  sendJson: (m) => inbox.push(m),
  sendBin: () => {},
  buffered: () => 0,
  close: () => {},
});

for (const [name, opts, half] of [
  ['паблик', {}, HALF_ROUNDS],
  ['матчмейкинг', { mode: 'mm', teamSize: 5, roster: Array.from({ length: 10 }, (_, i) => 'acc' + i) }, HALF_ROUNDS],
  ['союзники', { mode: 'wm', teamSize: 2, half: WINGMAN_HALF, roster: ['acc0', 'acc1', 'acc2', 'acc3'] }, WINGMAN_HALF],
] as const) {
  const room = new Room('easy', 0, 'market', opts as any);
  const inbox: ServerMsg[] = [];
  const c = conn('acc0', inbox);
  room.join(c);
  const me = room.players[c.slot];
  // конец первой половины: у всех гранаты, оружие, броня, набор
  for (const p of room.players) {
    p.nades = [1, 2, 1, 1];
    p.armor = 100;
    p.helmet = true;
    p.hasKit = true;
    p.purchases = [{ key: 'he', price: 300 }];
  }
  const teamBefore = me.team;
  room.roundNum = half;
  (room as any).startRound();
  // боты сразу покупают в новом раунде — проверяем игрока-человека
  const clean = [me].every((p) => p.nades.every((n) => n === 0) && p.armor === 0 && !p.helmet && !p.hasKit && !p.primary && p.purchases.length === 0);
  check(me.team !== teamBefore && clean, `${name}: после смены сторон гранат, брони и набора не осталось`);

  // смена команды вручную (клавиша M)
  const before = me.team;
  room.switchTeam(c, 1 - me.team);
  (room as any).startRound();
  const refused = inbox.some((m) => m.t === 'err' && /рейтинговом/.test(m.msg));
  if (room.ranked) check(me.team === before && refused, `${name}: сменить команду вручную нельзя («${(inbox.find((m) => m.t === 'err') as any)?.msg}»)`);
  else check(room.players.some((p) => p.conn === c && p.team !== before), `${name}: команду сменить можно (паблик)`);
}

console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
process.exit(ok ? 0 : 1);
