// Автотест карт союзников: 2 бота против 2 ботов на каждой карте 2×2.
// Проверяет, что точка достижима, бомбу удаётся заложить, не застревают и нет перекоса сторон сильнее 65/35.
// Запуск: npm run test:wingman -- [матчей на карту]

import { WINGMAN_HALF, WINGMAN_ROUND_TIME, WM_MAP_LIST } from '../shared/src/index';
import { Room } from '../server/src/room';

const matches = Number(process.argv[2] ?? 6);
let ok = true;
for (const { id, name } of WM_MAP_LIST) {
  const room = new Room('medium', 0, id, { mode: 'wm', id: 'test', teamSize: 2, half: WINGMAN_HALF, roundTime: WINGMAN_ROUND_TIME });
  room.lockMap = id;
  // точка достижима: в её прямоугольнике есть клетки, куда можно дойти
  const s = room.info.sites[0];
  let cells = 0;
  for (let i = 0; i < 200; i++) if (room.nav.randomIn(s.x0, s.z0, s.x1, s.z1, Math.random)) cells++;
  let plants = 0;
  const t0 = Date.now();
  let ticks = 0;
  while (room.stats.matches < matches && ticks < matches * 64 * 60 * 40) {
    const was = room.bomb.status;
    room.step();
    if (was !== 'planted' && room.bomb.status === 'planted') plants++;
    ticks++;
  }
  const rounds = room.stats.roundsWon[0] + room.stats.roundsWon[1];
  const t = rounds ? room.stats.roundsWon[0] / rounds : 0;
  const stuck = room.stats.stuck / Math.max(1, rounds);
  const good = cells > 150 && plants > 0 && t > 0.35 && t < 0.65 && stuck < 1.5;
  if (!good) ok = false;
  console.log(
    `${good ? 'OK  ' : 'FAIL'} ${name}: матчей ${room.stats.matches}, раундов ${rounds}, нападение ${(t * 100).toFixed(0)}%, закладок ${plants}, застреваний ${stuck.toFixed(2)}/раунд, точка достижима ${cells}/200, ${((Date.now() - t0) / 1000).toFixed(1)} с`,
  );
  console.log('     причины:', room.stats.reasons);
}
process.exit(ok ? 0 : 1);
