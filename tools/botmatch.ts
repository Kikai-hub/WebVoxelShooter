// Автотест «5 ботов против 5 ботов» без сети: гоняет матчи в ускоренном режиме
// и проверяет, что боты не застревают и нет перекоса побед сильнее 60/40.
// Запуск: npm run test:bots -- [число матчей]

import { Room } from '../server/src/room';

const matches = Number(process.argv[2] ?? 20);
const mapId = process.argv[3] ?? 'market';
const room = new Room('medium', 20, mapId === 'all' ? 'market' : mapId);
if (mapId !== 'all') room.lockMap = mapId;
console.log('Карта:', room.info.name);
const t0 = Date.now();
let maxTick = 0;
let ticks = 0;
const tickTimes: number[] = [];
const limit = matches * 40 * 64 * 200; // страховка от бесконечного цикла

while (room.stats.matches < matches && ticks < limit) {
  room.step();
  ticks++;
  if (room.tickTimeMs > maxTick) maxTick = room.tickTimeMs;
  if (ticks % 16 === 0) tickTimes.push(room.tickTimeMs);
}

tickTimes.sort((a, b) => a - b);
const p99 = tickTimes[Math.floor(tickTimes.length * 0.99)] ?? 0;
const rounds = room.stats.roundsWon[0] + room.stats.roundsWon[1];
const tShare = rounds ? room.stats.roundsWon[0] / rounds : 0;
const gameHours = (ticks / 64 / 3600).toFixed(2);

console.log(`Матчей: ${room.stats.matches}, раундов: ${rounds}, игрового времени: ${gameHours} ч, реального: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
console.log(`Раунды нападения/защиты: ${room.stats.roundsWon[0]} / ${room.stats.roundsWon[1]} (${(tShare * 100).toFixed(1)}% у нападения)`);
console.log(`Застреваний (срабатываний обхода): ${room.stats.stuck}, в среднем ${(room.stats.stuck / Math.max(1, rounds)).toFixed(2)} за раунд`);
console.log(`Тик: p99 ${p99.toFixed(3)} мс, максимум ${maxTick.toFixed(3)} мс`);

console.log(`Меткость: ${((room.stats.hits / Math.max(1, room.stats.shots)) * 100).toFixed(1)}% попаданий, хедшотов среди убийств ${((room.stats.headshots / Math.max(1, room.stats.kills)) * 100).toFixed(0)}%, выстрелов на убийство ${(room.stats.shots / Math.max(1, room.stats.kills)).toFixed(1)}`);
console.log('Сыграно карт:', room.stats.mapsPlayed);
console.log(`Гранат брошено: осколочных ${room.stats.nades[0]}, светошумовых ${room.stats.nades[1]}, дымовых ${room.stats.nades[2]}, зажигательных ${room.stats.nades[3]}; убийств гранатой (в т.ч. огнём) ${room.stats.nadeKills}; сильных ослеплений ${room.stats.blinded}`);
console.log('Причины:', room.stats.reasons, 'убийств', room.stats.kills, 'хедшотов', room.stats.headshots, 'разлётов', room.stats.explodes);
let ok = true;
if (room.stats.matches < matches) {
  console.error('ОШИБКА: матчи не завершились за отведённое время');
  ok = false;
}
if (rounds >= 20 && (tShare > 0.6 || tShare < 0.4)) {
  console.error('ОШИБКА: перекос по победам сторон больше 60/40');
  ok = false;
}
if (p99 > 4) {
  console.error('ОШИБКА: 99-й процентиль тика больше 4 мс');
  ok = false;
}
process.exit(ok ? 0 : 1);
