// Автотест помощи (как в CS): помощь получает союзник убийцы, нанёсший жертве не меньше 40 урона.
// Запуск: npm run test:assist

import { WEAPONS } from '../shared/src/index';
import { Room } from '../server/src/room';

let ok = true;
const check = (cond: boolean, what: string) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
  if (!cond) ok = false;
};
const room = new Room('easy', 0, 'market');
const gun = WEAPONS.find((w) => w.key === 'osa')!;
const [t1, t2, t3] = room.players.filter((p) => p.team === 0);
const [ct1, ct2] = room.players.filter((p) => p.team === 1);
const hit = (v: typeof t1, a: typeof t1, dmg: number) => room.damage(v, a, dmg, 1, [0, 0, 1], gun, null);
const lastKill = () => [...room.events].reverse().find((e) => e.e === 'kill') as { as?: number; k: number } | undefined;
for (const p of room.players) {
  p.armor = 0;
  p.hp = 100;
}

// 1) 45 урона от t2, добивает t1 → помощь t2
hit(ct1, t2, 45);
hit(ct1, t1, 100);
check(!ct1.alive && lastKill()?.k === t1.id && lastKill()?.as === t2.id && t2.assists === 1, 'нанёс 45 — помощь засчитана, в ленте «убийца + помощник»');

// 2) 30 урона — меньше 40% → помощи нет
hit(ct2, t3, 30);
hit(ct2, t1, 100);
check(lastKill()?.as === -1 && t3.assists === 0, 'нанёс 30 — помощи нет');

// 3) двое нанесли 40+ — помощь тому, кто больше
const [ct3] = room.players.filter((p) => p.team === 1 && p.alive);
hit(ct3, t2, 41);
hit(ct3, t3, 50);
hit(ct3, t1, 100);
check(lastKill()?.as === t3.id && t3.assists === 1 && t2.assists === 1, 'двое по 40+ — помощь тому, кто нанёс больше');

// 4) сам убийца помощь себе не получает
const [ct4] = room.players.filter((p) => p.team === 1 && p.alive);
hit(ct4, t1, 60);
hit(ct4, t1, 100);
check(lastKill()?.as === -1 && t1.assists === 0, 'урон самого убийцы помощью не считается');

// 5) в таблице счёта — графа помощи
const st = room.publicState(-2);
check(st.pl.find((p) => p.i === t2.id)?.as === 1 && st.pl.find((p) => p.i === t3.id)?.as === 1, 'помощь видна в таблице счёта');

console.log(ok ? 'Все проверки пройдены' : 'ЕСТЬ ОШИБКИ');
process.exit(ok ? 0 : 1);
