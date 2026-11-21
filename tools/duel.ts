// Дуэль: бот против неподвижного «игрока» в броне. Меряем время до убийства.
// Запуск: npx tsx tools/duel.ts [уровень] [дистанция] [оружие]
import { Room } from '../server/src/room';
import { WEAPON_BY_KEY, TEAM_CT, TEAM_T, newPState } from '../shared/src/index';

const level = process.argv[2] ?? 'medium';
const dist = Number(process.argv[3] ?? 16);
const weapon = process.argv[4] ?? 'vikhr';
const times: number[] = [];
let headshots = 0;
for (let trial = 0; trial < 40; trial++) {
  const room = new Room(level);
  room.step();
  const target = room.players[0];
  const bot = room.players[5];
  for (const p of room.players) if (p !== target && p !== bot) p.alive = false;
  target.isBot = false;
  target.bot = null;
  target.disconnectedAt = 1e9;
  target.team = TEAM_T;
  bot.team = TEAM_CT;
  target.st = newPState(30, 0.5, 14);
  target.alive = true;
  target.hp = 100;
  target.armor = 100;
  target.hasBomb = false;
  bot.st = newPState(30, 0.5, 14 + dist);
  bot.yaw = 0;
  bot.primary = { def: WEAPON_BY_KEY[weapon], mag: 30, reserve: 90 };
  bot.slot = 0;
  (bot.bot as any).wantSlot = 0;
  (bot.bot as any).yaw = 0;
  (bot.bot as any).goal = { x: 30, z: 14 + dist, kind: 'hold', until: 1e9, lookYaw: 0 };
  room.phase = 'live';
  room.phaseEnd = 1e9;
  room.bomb.status = 'none';
  const t0 = room.time;
  const killsBefore = room.stats.headshots;
  for (let i = 0; i < 64 * 15 && target.alive; i++) room.step();
  if (!target.alive) {
    times.push(room.time - t0);
    if (room.stats.headshots > killsBefore) headshots++;
  }
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
console.log(`${level}, ${dist} м, ${weapon}: убит в ${times.length}/40, среднее ${avg.toFixed(2)} с, медиана ${(times[times.length >> 1] ?? 0).toFixed(2)} с, быстрее 1 с: ${times.filter((t) => t < 1).length}, хедшотом: ${headshots}`);
