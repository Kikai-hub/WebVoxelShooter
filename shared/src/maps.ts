// Ещё две оригинальные карты и реестр всех карт для голосования.
// Планировки свои: общие идеи (две точки, три маршрута, центр) — без копирования чужих карт.

import { Rng } from './rng';
import { FLOOR, MAT, VoxelMap, archX, buildMarketSquare, crate, palm, wall, type MapInfo, type Rect } from './map';

/** Скала из столбиков разной высоты (детерминированно по зерну). */
function rock(m: VoxelMap, rng: Rng, x0: number, z0: number, x1: number, z1: number, hMin: number, hMax: number, mat: number = MAT.ROCK) {
  for (let x = x0; x < x1; x += 1)
    for (let z = z0; z < z1; z += 1) {
      const h = Math.round(rng.range(hMin, hMax) * 2) / 2;
      m.fill(x, z, Math.min(x + 1, x1), Math.min(z + 1, z1), FLOOR, FLOOR + h, mat);
    }
}

/** Разрушенная стена: верх неровный, местами провалы до колена. */
function ruin(m: VoxelMap, rng: Rng, x0: number, z0: number, x1: number, z1: number, hMin: number, hMax: number) {
  const alongX = x1 - x0 >= z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  for (let i = 0; i < len; i += 1) {
    const h = Math.round(rng.range(hMin, hMax) * 2) / 2;
    if (alongX) m.fill(x0 + i, z0, Math.min(x0 + i + 1, x1), z1, FLOOR, FLOOR + h, MAT.SAND);
    else m.fill(x0, z0 + i, x1, Math.min(z0 + i + 1, z1), FLOOR, FLOOR + h, MAT.SAND);
  }
}

function spawnRows(x0: number, z0: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) out.push([x0 + i * 2.5, z0], [x0 + 1.2 + i * 2.5, z1]);
  return out;
}

/** «Пустошь»: 60×60 м, открытая, длинные линии обзора, точки в развалинах по краям. */
export function buildWasteland(): MapInfo {
  const m = new VoxelMap(120, 18, 120);
  const rng = new Rng(20261121);
  m.fill(0, 0, 60, 60, 0, FLOOR, MAT.GROUND);

  // Края — скалы
  rock(m, rng, 0, 0, 60, 1, 6, 7.5);
  rock(m, rng, 0, 59, 60, 60, 6, 7.5);
  rock(m, rng, 0, 0, 1, 60, 6, 7.5);
  rock(m, rng, 59, 0, 60, 60, 6, 7.5);

  // Скальные массивы между проходами и центром
  rock(m, rng, 12, 12, 22, 34, 5, 7);
  rock(m, rng, 38, 12, 48, 34, 5, 7);
  // Скала перед базой нападения (нет прострела от базы до базы)
  rock(m, rng, 26, 10, 34, 12, 4.5, 6);
  // Центральная скала делит середину на два прохода
  rock(m, rng, 27, 23, 33, 29, 3.5, 4.5);

  // Северная гряда развалин с проходами к точкам и в центр
  ruin(m, rng, 1, 46, 4, 47, 2.5, 4);
  ruin(m, rng, 12, 46, 26, 47, 2.5, 4);
  ruin(m, rng, 31, 46, 48, 47, 2.5, 4);
  ruin(m, rng, 56, 46, 59, 47, 2.5, 4);

  // Стены между центром и точками, с проломами
  ruin(m, rng, 20, 34, 22, 38, 2.5, 4);
  ruin(m, rng, 20, 41, 22, 46, 2.5, 4);
  ruin(m, rng, 38, 34, 40, 39, 2.5, 4);
  ruin(m, rng, 38, 42, 40, 46, 2.5, 4);

  // Точка A: развалины дома
  const siteA: Rect = { x0: 2, z0: 35, x1: 19, z1: 45 };
  const siteB: Rect = { x0: 41, z0: 35, x1: 58, z1: 45 };
  m.fill(6, 38, 14, 44, 0, FLOOR, MAT.SITE);
  m.fill(44, 38, 52, 44, 0, FLOOR, MAT.SITE);
  ruin(m, rng, 4, 36, 10, 37, 0.5, 2);
  ruin(m, rng, 15, 38, 16, 44, 0.5, 2.5);
  crate(m, 9, 40, 2, 2, 1);
  crate(m, 5, 42, 1.5, 1.5, 1);
  m.fill(12, 36, 13, 37, FLOOR, FLOOR + 3.5, MAT.SAND); // колонна
  m.fill(3, 44, 4, 45, FLOOR, FLOOR + 3, MAT.SAND);
  // Точка B: другой рисунок укрытий
  ruin(m, rng, 50, 36, 56, 37, 0.5, 2);
  ruin(m, rng, 43, 40, 44, 45, 0.5, 2.5);
  crate(m, 48, 41, 2, 2, 2);
  crate(m, 54, 39, 1.5, 1.5, 1);
  m.fill(46, 37, 47, 38, FLOOR, FLOOR + 3.5, MAT.SAND);

  // Укрытия в длинных проходах — редкие, линии обзора длинные
  rock(m, rng, 4, 18, 6, 20, 1, 1.5);
  rock(m, rng, 8, 27, 10, 29, 1, 1.5);
  rock(m, rng, 52, 16, 54, 18, 1, 1.5);
  rock(m, rng, 50, 26, 52, 28, 1, 1.5);
  // Середина
  crate(m, 23, 16, 2, 2, 1);
  crate(m, 35, 19, 2, 2, 1);
  crate(m, 24, 38, 1.5, 1.5, 1);
  crate(m, 34.5, 36, 1.5, 1.5, 1);
  // База защиты
  crate(m, 14, 52, 2, 2, 1);
  crate(m, 44, 53, 2, 2, 1);
  // Сухие пальмы
  palm(m, 8, 6, 4);
  palm(m, 52, 5, 4.5);
  palm(m, 30, 54, 4);

  return {
    id: 'wasteland',
    name: 'Пустошь',
    desc: 'Открытая, дальние дистанции, точки в развалинах — выигрывают винтовки',
    map: m,
    sites: [siteA, siteB],
    siteNames: ['A', 'B'],
    spawns: [spawnRows(24, 3, 5.5), spawnRows(24, 56, 53.5)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 59, z1: 10 },
      { x0: 1, z0: 48, x1: 59, z1: 59 },
    ],
    mid: [30, 40],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'Точка B', r: siteB },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 59, z1: 12 } },
      { name: 'База защиты', r: { x0: 1, z0: 47, x1: 59, z1: 59 } },
      { name: 'Каньон', r: { x0: 22, z0: 12, x1: 38, z1: 46 } },
      { name: 'Западная тропа', r: { x0: 1, z0: 12, x1: 12, z1: 35 } },
      { name: 'Восточная тропа', r: { x0: 48, z0: 12, x1: 59, z1: 35 } },
    ],
  };
}

/** «Старый квартал»: 44×44 м, тесный, проходы через дома, двор, второй ярус. */
export function buildOldQuarter(): MapInfo {
  const m = new VoxelMap(88, 18, 88);
  m.fill(0, 0, 44, 44, 0, FLOOR, MAT.COBBLE);

  // Внешние стены
  wall(m, 0, 0, 44, 1, 7, MAT.PLASTER);
  wall(m, 0, 43, 44, 44, 7, MAT.PLASTER);
  wall(m, 0, 0, 1, 44, 7, MAT.PLASTER);
  wall(m, 43, 0, 44, 44, 7, MAT.PLASTER);

  // Западный квартал с проходным домом
  wall(m, 5, 8, 19, 22, 6, MAT.PLASTER);
  m.fill(5, 8, 19, 22, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(8, 12, 17, 21, FLOOR, FLOOR + 3.5, MAT.AIR); // комната
  m.fill(8, 12, 17, 21, 0, FLOOR, MAT.TILE);
  m.fill(17, 15, 19, 17, FLOOR, FLOOR + 2.5, MAT.AIR); // дверь на улицу
  m.fill(5, 13, 8, 15, FLOOR, FLOOR + 2.5, MAT.AIR); // дверь в переулок
  crate(m, 10, 18, 1.5, 1.5, 1);
  crate(m, 14, 13, 1.5, 1.5, 1);
  // Низкий дом с плоской крышей у двора A и лестница на крышу (второй ярус)
  wall(m, 5, 22, 17, 26, 3, MAT.SAND);
  m.fill(5, 22, 17, 22.5, FLOOR + 3, FLOOR + 3.5, MAT.SAND); // парапет
  for (let i = 0; i < 6; i++) m.fill(9 + i * 0.5, 26, 9.5 + i * 0.5, 27.5, FLOOR, FLOOR + (i + 1) * 0.5, MAT.SAND);

  // Восточный квартал с проходным домом на точку B
  wall(m, 25, 8, 39, 26, 6, MAT.BRICK);
  m.fill(25, 8, 39, 26, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(27, 13, 36, 22, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(27, 13, 36, 22, 0, FLOOR, MAT.TILE);
  m.fill(25, 19, 27, 21, FLOOR, FLOOR + 2.5, MAT.AIR); // дверь с улицы
  m.fill(30, 22, 32, 26, FLOOR, FLOOR + 2.5, MAT.AIR); // выход на B
  crate(m, 33, 15, 2, 2, 1);
  crate(m, 28, 19.5, 1.5, 1.5, 1);

  // Ворота на главной улице: закрывают прострел с базы нападения
  wall(m, 19, 9, 25, 10, 6, MAT.BRICK);
  m.fill(22, 9, 24.5, 10, FLOOR, FLOOR + 3, MAT.AIR);
  // Лавка посреди улицы
  crate(m, 21, 16, 2, 3, 1);
  m.fill(20.5, 15.5, 23.5, 19.5, FLOOR + 2.5, FLOOR + 3, MAT.WOOD); // навес
  m.fill(20.5, 15.5, 21, 16, FLOOR, FLOOR + 2.5, MAT.WOOD);
  m.fill(23, 19, 23.5, 19.5, FLOOR, FLOOR + 2.5, MAT.WOOD);

  // Переулки: укрытия
  crate(m, 2, 11, 1.5, 1.5, 1);
  crate(m, 3, 19, 1.5, 1.5, 1);
  crate(m, 40, 13, 1.5, 1.5, 1);
  crate(m, 41, 21, 1.5, 1.5, 1);

  // Северная стена кварталов с проходами в базу защиты
  wall(m, 1, 36, 6, 37, 6, MAT.PLASTER);
  // главная улица упирается в стену: в базу защиты — только через точки
  wall(m, 10, 36, 34, 37, 6, MAT.PLASTER);
  for (let x = 20; x < 25; x += 2) m.fill(x, 35.5, x + 1, 36, 2.5, 3.5, MAT.DARK); // окна
  wall(m, 38, 36, 43, 37, 6, MAT.PLASTER);
  archX(m, 6, 10, 36, 37, 3);

  // Двор A с колодцем; стена к улице с проломом
  const siteA: Rect = { x0: 1, z0: 27, x1: 16, z1: 35 };
  const siteB: Rect = { x0: 28, z0: 27, x1: 42, z1: 35 };
  wall(m, 17, 26, 19, 29, 6, MAT.PLASTER);
  wall(m, 17, 32, 19, 36, 6, MAT.PLASTER);
  m.fill(3, 28, 12, 34, 0, FLOOR, MAT.SITE);
  wall(m, 8, 30, 10, 32, 1, MAT.SAND);
  m.fill(8.5, 30.5, 9.5, 31.5, FLOOR + 0.5, FLOOR + 1, MAT.WATER);
  crate(m, 3, 32, 2, 2, 2);
  // заслон напротив пролома с улицы: двор не простреливается насквозь
  wall(m, 13.5, 28.5, 14, 33.5, 3, MAT.SAND);
  palm(m, 15.5, 35, 4);
  // Рынок B: прилавки под навесами; стена к улице с проломом
  wall(m, 25, 26, 27, 31, 6, MAT.BRICK);
  wall(m, 25, 34, 27, 36, 6, MAT.BRICK);
  m.fill(30, 28, 38, 34, 0, FLOOR, MAT.SITE);
  for (const [x, z] of [
    [30, 29],
    [35, 31.5],
    [39.5, 28.5],
  ] as const) {
    crate(m, x, z, 2, 1, 1);
    m.fill(x - 0.5, z - 0.5, x + 2.5, z + 1.5, FLOOR + 2.5, FLOOR + 3, MAT.WOOD);
  }
  crate(m, 33, 34, 1.5, 1.5, 1);

  // Узкие входы на точки со стороны нападения и укрытия защиты в глубине точек
  crate(m, 1, 25, 1.5, 1.5, 2); // выход из западного переулка
  crate(m, 41.5, 25, 1.5, 1.5, 2); // выход из восточного переулка
  wall(m, 39, 26, 43, 26.5, 2, MAT.SAND);
  m.fill(40.5, 26, 42, 26.5, FLOOR, FLOOR + 2, MAT.AIR); // проход 1,5 м
  crate(m, 6, 34.5, 2, 1.5, 1);
  crate(m, 38, 33.5, 2, 1.5, 1);
  crate(m, 29, 33, 1.5, 1.5, 1);

  // База защиты
  crate(m, 12, 40, 2, 2, 1);
  crate(m, 30, 39.5, 2, 2, 1);

  return {
    id: 'quarter',
    name: 'Старый квартал',
    desc: 'Тесная, ближний бой: переулки, проходы через дома, крыша над двором',
    map: m,
    sites: [siteA, siteB],
    siteNames: ['A', 'B'],
    spawns: [spawnRows(11, 3, 5.5), spawnRows(11, 41, 39)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 43, z1: 8 },
      { x0: 1, z0: 37, x1: 43, z1: 43 },
    ],
    mid: [22, 30],
    // центр простреливается со всех сторон — пятый защитник страхует A
    ctRoles: [0, 1, 0, 1, 0],
    zones: [
      { name: 'Двор A', r: siteA },
      { name: 'Рынок B', r: siteB },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 43, z1: 8 } },
      { name: 'База защиты', r: { x0: 1, z0: 37, x1: 43, z1: 43 } },
      { name: 'Западный дом', r: { x0: 5, z0: 8, x1: 19, z1: 22 } },
      { name: 'Восточный дом', r: { x0: 25, z0: 8, x1: 39, z1: 26 } },
      { name: 'Главная улица', r: { x0: 19, z0: 8, x1: 25, z1: 37 } },
      { name: 'Западный переулок', r: { x0: 1, z0: 8, x1: 5, z1: 27 } },
      { name: 'Восточный переулок', r: { x0: 39, z0: 8, x1: 43, z1: 27 } },
    ],
  };
}

export const MAPS: Record<string, () => MapInfo> = {
  market: buildMarketSquare,
  wasteland: buildWasteland,
  quarter: buildOldQuarter,
};

export const MAP_LIST = [
  { id: 'market', name: 'Рыночная площадь', desc: 'Средняя дистанция, сильный центр' },
  { id: 'wasteland', name: 'Пустошь', desc: 'Открытая, дальние дистанции' },
  { id: 'quarter', name: 'Старый квартал', desc: 'Тесная, ближний бой' },
];
