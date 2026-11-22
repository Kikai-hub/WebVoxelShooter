// Автотест лобби и поиска группой без сети: приглашения, принятие, выход и исключение;
// лобби в рейтинговом поиске всегда в одной команде; паблик для лобби — с местами на всех.
// Запуск: npm run test:party

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/src/accounts';
import { PartyStore } from '../server/src/party';
import { RoomManager } from '../server/src/rooms';

const dir = mkdtempSync(join(tmpdir(), 'vts-party-'));
let ok = true;
const check = (cond: boolean, what: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
  if (!cond) ok = false;
};

async function main() {
  const accounts = new AccountStore(dir);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await accounts.register(`party${i}`, 'password123', '10.0.' + Math.floor(i / 4) + '.' + i);
    if ('error' in r) throw new Error(r.error);
    ids.push(r.account.id);
  }
  const [A, B, C, D] = ids;
  const parties = new PartyStore(() => false);

  // ---- приглашения ----
  check(parties.invite(A, B) === 'Игрок сейчас не в сети', 'нельзя пригласить того, кто не в сети');
  for (const id of ids) parties.touch(id);
  check(parties.invite(A, A) !== null, 'нельзя пригласить самого себя');
  check(parties.invite(A, B) === null && parties.invitesFor(B).length === 1, 'приглашение дошло');
  check(parties.invite(A, B) !== null, 'повторно то же приглашение не отправляется');
  const inv = parties.invitesFor(B)[0];
  check(parties.accept(B, inv.id) === null && parties.members(A).length === 2 && parties.of(B)?.leader === A, 'принял — в лобби двое, лидер A');
  check(parties.invite(B, C) === 'Приглашать может только лидер лобби', 'приглашает только лидер');
  parties.invite(A, C);
  parties.decline(C, parties.invitesFor(C)[0].id);
  check(parties.members(A).length === 2 && parties.invitesFor(C).length === 0, 'отклонил — лобби не изменилось');
  parties.invite(A, C);
  parties.accept(C, parties.invitesFor(C)[0].id);
  check(parties.kick(A, C) === null && parties.members(A).length === 2 && parties.of(C) === null, 'лидер исключил игрока');
  parties.leave(A);
  check(parties.of(B) === null && parties.of(A) === null, 'лидер вышел из лобби на двоих — лобби распалось');

  // ---- поиск группой: союзники, лобби A+B и двое одиночек ----
  const rm = new RoomManager(accounts, 'medium', 0);
  const mm = (rm as any).matchmake.bind(rm) as () => void;
  const who = (id: string) => ({ accountId: id, login: accounts.get(id)!.login });
  rm.enqueue([who(A), who(B)], 'wm');
  rm.enqueue([who(C)], 'wm');
  mm();
  check(rm.rooms.size === 0 && rm.queueState(B).state === 'searching' && rm.queueState(B).party === 2, 'лобби в поиске: участник видит поиск своей группы');
  rm.enqueue([who(D)], 'wm');
  mm();
  const room = [...rm.rooms.values()][0];
  const teamOf = (id: string) => room.players[room.roster!.indexOf(id)].team;
  check(!!room && teamOf(A) === teamOf(B) && teamOf(C) === teamOf(D) && teamOf(A) !== teamOf(C), 'матч 2×2: лобби A+B в одной команде');

  // ---- матчмейкинг 5×5: лобби из 3, лобби из 2 и 5 одиночек ----
  const rest = ids.slice(2); // 10 игроков: C..
  const rm2 = new RoomManager(accounts, 'medium', 0);
  const mm2 = (rm2 as any).matchmake.bind(rm2) as () => void;
  rm2.enqueue(rest.slice(0, 3).map(who), 'mm');
  rm2.enqueue(rest.slice(3, 5).map(who), 'mm');
  for (const id of rest.slice(5, 10)) rm2.enqueue([who(id)], 'mm');
  mm2();
  const r2 = [...rm2.rooms.values()][0];
  const t2 = (id: string) => r2.players[r2.roster!.indexOf(id)].team;
  const sameA = rest.slice(0, 3).every((id) => t2(id) === t2(rest[0]));
  const sameB = rest.slice(3, 5).every((id) => t2(id) === t2(rest[3]));
  check(!!r2 && sameA && sameB, 'матч 5×5: лобби из 3 и лобби из 2 не разорваны');
  check(rm2.queueState(rest[9]).state === 'found', 'все 10 игроков нашли матч');

  // ---- паблик для лобби ----
  const p = rm.publicFor(4);
  check(typeof p !== 'string' && p.players.filter((q) => q.isBot).length >= 4, 'паблик для лобби из 4 — с местами на всех');
  check(rm.route(A, 'public', typeof p !== 'string' ? p.id : undefined) === p, 'участник лобби входит в комнату, выбранную лидером');

  accounts.flush();
  rmSync(dir, { recursive: true, force: true });
  console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
  process.exit(ok ? 0 : 1);
}
void main();
