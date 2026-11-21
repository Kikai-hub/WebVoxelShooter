// Две большие карты в духе пустынного города. Планировки оригинальные:
// общие идеи (длинный простреливаемый проход, крытый туннель, рынок, двор) — без копирования чужих карт.

import { Rng } from './rng';
import { FLOOR, MAT, VoxelMap, archX, archZ, crate, palm, wall, type MapInfo, type Rect } from './map';

function spawnRows(x0: number, z0: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) out.push([x0 + i * 2.5, z0], [x0 + 1.2 + i * 2.5, z1]);
  return out;
}

/** Прилавок: ящик и навес на столбиках. */
function stall(m: VoxelMap, x: number, z: number, w: number, d: number) {
  crate(m, x, z, w, d, 1);
  m.fill(x - 0.5, z - 0.5, x + w + 0.5, z + d + 0.5, FLOOR + 2.5, FLOOR + 3, MAT.WOOD);
  m.fill(x - 0.5, z - 0.5, x, z, FLOOR, FLOOR + 2.5, MAT.WOOD);
  m.fill(x + w, z + d, x + w + 0.5, z + d + 0.5, FLOOR, FLOOR + 2.5, MAT.WOOD);
}

/** Чан красильни: низкий борт и вода внутри. */
function vat(m: VoxelMap, x: number, z: number, s: number) {
  wall(m, x, z, x + s, z + s, 1, MAT.SAND);
  m.fill(x + 0.5, z + 0.5, x + s - 0.5, z + s - 0.5, FLOOR + 0.5, FLOOR + 1, MAT.WATER);
}

/** «Караван-сарай»: 62×62 м. Нападение на юге, защита на севере. */
export function buildCaravanserai(): MapInfo {
  const m = new VoxelMap(124, 18, 124);
  const rng = new Rng(4242);
  m.fill(0, 0, 62, 62, 0, FLOOR, MAT.COBBLE);

  // Внешние стены и угловые башни
  wall(m, 0, 0, 62, 1, 7, MAT.SAND);
  wall(m, 0, 61, 62, 62, 7, MAT.SAND);
  wall(m, 0, 0, 1, 62, 7, MAT.SAND);
  wall(m, 61, 0, 62, 62, 7, MAT.SAND);
  for (const [x, z] of [
    [0, 0],
    [58, 0],
    [0, 58],
    [58, 58],
  ]) {
    wall(m, x, z, x + 4, z + 4, 9, MAT.SAND);
    m.fill(x, z, x + 4, z + 4, FLOOR + 9, FLOOR + 9.5, MAT.ROOF);
  }
  m.fill(24, 2, 38, 7, 0, FLOOR, MAT.TILE);
  m.fill(24, 55, 38, 60, 0, FLOOR, MAT.TILE);

  // Западный квартал и крытая галерея вдоль него (длинный простреливаемый проход к A)
  wall(m, 10, 9, 24, 34, 6, MAT.PLASTER);
  m.fill(10, 9, 24, 34, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  for (let z = 10; z < 34; z += 3) m.fill(7, z, 8, z + 1, FLOOR, FLOOR + 4, MAT.SAND);
  m.fill(7, 9, 10, 34, FLOOR + 4, FLOOR + 4.5, MAT.WOOD);
  for (let z = 11; z < 33; z += 5) m.fill(9.5, z, 10, z + 1, 2, 3.5, MAT.DARK); // двери-ниши под галереей
  crate(m, 3, 18, 2, 2, 1);
  crate(m, 4.5, 27, 1.5, 1.5, 1);
  wall(m, 1, 23, 4, 23.5, 1, MAT.SAND);
  // проход из двора на короткий вход к A
  m.fill(15, 30, 24, 34, FLOOR, FLOOR + 3, MAT.AIR);
  wall(m, 10, 34, 15, 38, 6, MAT.PLASTER);
  wall(m, 19, 34, 24, 38, 6, MAT.PLASTER);
  archZ(m, 34, 38, 15, 19, 3);
  m.fill(15, 34, 19, 38, FLOOR + 3.5, FLOOR + 6, MAT.PLASTER);

  // Восточный кирпичный квартал с извилистым крытым туннелем к B
  wall(m, 38, 9, 61, 38, 6, MAT.BRICK);
  m.fill(38, 9, 61, 38, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(50, 9, 55, 23, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(44, 22, 55, 26, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(44, 25, 48, 38, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(50, 9, 55, 23, 0, FLOOR, MAT.DARK);
  m.fill(44, 22, 55, 26, 0, FLOOR, MAT.DARK);
  m.fill(44, 25, 48, 38, 0, FLOOR, MAT.DARK);
  crate(m, 53, 14, 1.5, 1.5, 1);
  crate(m, 46, 23, 1.5, 1.5, 1);
  // крытый проход из двора в туннель (ротация через центр)
  m.fill(38, 30, 44, 33, FLOOR, FLOOR + 3, MAT.AIR);
  m.fill(38, 30, 44, 33, 0, FLOOR, MAT.DARK);

  // Ворота между базой нападения и двором — два узких прохода, нет прострела до базы защиты
  wall(m, 26, 9, 36, 11, 6, MAT.BRICK);
  m.fill(26, 9, 36, 11, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);

  // Двор с колодцем под навесом и торговыми рядами
  wall(m, 29, 21, 33, 25, 1, MAT.SAND);
  m.fill(29.5, 21.5, 32.5, 24.5, FLOOR + 0.5, FLOOR + 1, MAT.WATER);
  for (const [x, z] of [
    [28.5, 20.5],
    [33, 20.5],
    [28.5, 25],
    [33, 25],
  ])
    m.fill(x, z, x + 0.5, z + 0.5, FLOOR, FLOOR + 3.5, MAT.WOOD);
  m.fill(28.5, 20.5, 33.5, 25.5, FLOOR + 3.5, FLOOR + 4, MAT.ROOF);
  stall(m, 25, 14, 2, 1.5);
  stall(m, 33, 16, 1.5, 2);
  crate(m, 25.5, 31, 2, 2, 2);
  crate(m, 35.5, 27.5, 1.5, 1.5, 1);
  palm(m, 25, 25.5, 4.5);

  // Стена между двором и площадью за точками, с проёмом
  // проём у восточного края, за ним заслон — площадь не простреливается из двора
  wall(m, 24, 36, 34, 38, 6, MAT.SAND);
  m.fill(34, 36, 37, 38, FLOOR + 3.5, FLOOR + 6, MAT.SAND);
  wall(m, 31, 39.5, 38, 40, 2.5, MAT.SAND);

  // Точки и стены между ними и площадью (с проломами)
  const siteA: Rect = { x0: 2, z0: 39, x1: 19, z1: 51 };
  const siteB: Rect = { x0: 43, z0: 39, x1: 60, z1: 51 };
  wall(m, 20, 38, 22, 43, 6, MAT.PLASTER);
  wall(m, 20, 46, 22, 52, 6, MAT.PLASTER);
  wall(m, 40, 38, 42, 44, 6, MAT.BRICK);
  wall(m, 40, 47, 42, 52, 6, MAT.BRICK);
  m.fill(5, 41, 17, 50, 0, FLOOR, MAT.SITE);
  m.fill(45, 41, 57, 50, 0, FLOOR, MAT.SITE);
  // Укрытия на A: будка, ящики, низкая стенка
  wall(m, 9, 44, 12, 47, 3, MAT.PLASTER);
  m.fill(8.5, 43.5, 12.5, 47.5, FLOOR + 3, FLOOR + 3.5, MAT.ROOF);
  crate(m, 5, 40, 2, 2, 1);
  crate(m, 15, 48, 2, 2, 2);
  wall(m, 13, 40, 17, 40.5, 1, MAT.SAND);
  crate(m, 3, 49, 1.5, 1.5, 1);
  // Укрытия на B: колонны, повозка, ящики
  for (const [x, z] of [
    [46, 42],
    [52, 42],
    [46, 48],
  ])
    m.fill(x, z, x + 1, z + 1, FLOOR, FLOOR + 4, MAT.SAND);
  crate(m, 50, 46, 3, 1.5, 1);
  crate(m, 55, 41, 2, 2, 2);
  wall(m, 43, 49.5, 47, 50, 1, MAT.SAND);

  // Площадь между точками
  palm(m, 30, 46, 4.5);
  m.fill(30.5, 41, 31.5, 42, FLOOR, FLOOR + 3, MAT.SAND);
  crate(m, 24, 41, 2, 2, 1);
  crate(m, 36, 48, 2, 2, 1);
  crate(m, 26, 49, 1.5, 1.5, 1);

  // Северная стена: в базу защиты через A, центр и B
  wall(m, 1, 52, 5, 53, 6, MAT.SAND);
  wall(m, 12, 52, 31, 53, 6, MAT.SAND);
  wall(m, 35, 52, 49, 53, 6, MAT.SAND);
  wall(m, 56, 52, 61, 53, 6, MAT.SAND);
  archX(m, 5, 12, 52, 53, 3.5);
  m.fill(5, 52, 12, 53, FLOOR + 4, FLOOR + 6, MAT.SAND);
  crate(m, 16, 56, 2, 2, 1);
  crate(m, 44, 57, 2, 2, 1);
  palm(m, 4, 8, 4);
  palm(m, 57, 6, 4);
  void rng;

  return {
    id: 'caravan',
    name: 'Караван-сарай',
    desc: 'Большая: длинная галерея к A, крытый туннель к B, двор с колодцем',
    map: m,
    sites: [siteA, siteB],
    siteNames: ['A', 'B'],
    spawns: [spawnRows(25, 3, 5.5), spawnRows(25, 58, 55.5)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 61, z1: 9 },
      { x0: 1, z0: 53, x1: 61, z1: 61 },
    ],
    mid: [31, 44],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'Точка B', r: siteB },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 61, z1: 9 } },
      { name: 'База защиты', r: { x0: 1, z0: 53, x1: 61, z1: 61 } },
      { name: 'Галерея', r: { x0: 1, z0: 9, x1: 10, z1: 38 } },
      { name: 'Туннель', r: { x0: 38, z0: 9, x1: 61, z1: 38 } },
      { name: 'Двор', r: { x0: 24, z0: 11, x1: 38, z1: 36 } },
      { name: 'Короткий вход', r: { x0: 10, z0: 30, x1: 24, z1: 38 } },
      { name: 'Площадь', r: { x0: 22, z0: 38, x1: 40, z1: 52 } },
    ],
  };
}

/** «Медина»: 60×60 м. Переулки, крытый базар, длинная улица, крыша над переулком. */
export function buildMedina(): MapInfo {
  const m = new VoxelMap(120, 18, 120);
  m.fill(0, 0, 60, 60, 0, FLOOR, MAT.COBBLE);

  wall(m, 0, 0, 60, 1, 7, MAT.PLASTER);
  wall(m, 0, 59, 60, 60, 7, MAT.PLASTER);
  wall(m, 0, 0, 1, 60, 7, MAT.PLASTER);
  wall(m, 59, 0, 60, 60, 7, MAT.PLASTER);
  m.fill(22, 2, 38, 7, 0, FLOOR, MAT.TILE);
  m.fill(22, 53, 38, 58, 0, FLOOR, MAT.TILE);

  // Западный квартал
  wall(m, 7, 9, 26, 22, 6, MAT.PLASTER);
  m.fill(7, 9, 26, 22, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  for (let x = 9; x < 24; x += 4) m.fill(x, 21.5, x + 1, 22, 2, 3.5, MAT.DARK);
  // Низкий дом с плоской крышей и лестницей (второй ярус над переулком и A)
  wall(m, 7, 22, 26, 34, 2.5, MAT.SAND);
  m.fill(7, 22, 26, 22.5, FLOOR + 2.5, FLOOR + 3, MAT.SAND); // парапет
  for (let i = 0; i < 5; i++) m.fill(12, 36.5 - i * 0.5, 14, 37 - i * 0.5, FLOOR, FLOOR + (i + 1) * 0.5, MAT.SAND);
  m.fill(12, 34, 14, 34.5, FLOOR, FLOOR + 2.5, MAT.SAND); // площадка: верхняя ступень вплотную к крыше
  // Петляющий переулок к A: стенки заставляют идти змейкой
  wall(m, 1, 15, 4.5, 16, 6, MAT.PLASTER);
  wall(m, 3.5, 22, 7, 23, 6, MAT.PLASTER);
  wall(m, 1, 29, 4.5, 30, 6, MAT.PLASTER);
  crate(m, 5, 11, 1.5, 1.5, 1);
  crate(m, 1.5, 33, 1.5, 1.5, 1);

  // Центральный крытый базар: навесы с просветами, прилавки по бокам
  wall(m, 24, 8, 36, 9.5, 6, MAT.BRICK);
  m.fill(30, 8, 33, 9.5, FLOOR, FLOOR + 3, MAT.AIR); // вход с базы нападения (смещён)
  for (let z = 12; z < 38; z += 6) m.fill(26, z, 34, z + 4, FLOOR + 3.5, FLOOR + 4, MAT.WOOD);
  for (let z = 12; z < 38; z += 4) {
    const left = (z / 4) % 2 === 0;
    crate(m, left ? 26 : 32.5, z, 1.5, 2, 1);
  }
  wall(m, 26, 9.5, 26.5, 38, 4, MAT.BRICK); // стены рядов
  wall(m, 33.5, 9.5, 34, 38, 4, MAT.BRICK);
  m.fill(7, 18, 26.5, 21, FLOOR, FLOOR + 2.5, MAT.AIR); // крытый переход базар ↔ переулок
  m.fill(7, 18, 26, 21, 0, FLOOR, MAT.DARK);
  m.fill(33.5, 26, 34, 29, FLOOR, FLOOR + 2.5, MAT.AIR);
  // Северный выход базара — смещён относительно входа
  wall(m, 24, 38, 36, 40, 6, MAT.BRICK);
  m.fill(26, 38, 29, 40, FLOOR, FLOOR + 3, MAT.AIR);

  // Восточный квартал складов и длинная улица вдоль него
  wall(m, 36, 9, 47, 36, 6, MAT.BRICK);
  m.fill(36, 9, 47, 36, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(34, 20, 47, 23, FLOOR, FLOOR + 3, MAT.AIR); // крытый проход базар ↔ улица
  m.fill(34, 20, 47, 23, 0, FLOOR, MAT.DARK);
  crate(m, 50, 16, 3, 1.5, 1); // повозки на улице
  crate(m, 54, 27, 3, 1.5, 1);
  crate(m, 48, 31, 1.5, 1.5, 2);
  palm(m, 56.5, 10, 4.5);

  // Точка A «Красильни»: чаны и сушилки
  const siteA: Rect = { x0: 2, z0: 37, x1: 21, z1: 50 };
  const siteB: Rect = { x0: 39, z0: 37, x1: 58, z1: 50 };
  m.fill(4, 39, 19, 49, 0, FLOOR, MAT.SITE);
  vat(m, 5, 41, 3);
  vat(m, 10, 45, 3);
  vat(m, 15, 40, 3);
  for (const x of [5, 9, 13, 17]) m.fill(x, 47.5, x + 0.5, 48, FLOOR, FLOOR + 3, MAT.WOOD); // шесты
  m.fill(5, 47.5, 17.5, 48, FLOOR + 3, FLOOR + 3.5, MAT.WOOD);
  crate(m, 18, 46, 2, 2, 1);
  // Стены площади с проломами к A и B
  wall(m, 21, 37, 23, 43, 6, MAT.PLASTER);
  wall(m, 21, 46, 23, 51, 6, MAT.PLASTER);
  wall(m, 37, 37, 39, 40, 6, MAT.BRICK);
  wall(m, 37, 43, 39, 51, 6, MAT.BRICK);

  // Точка B «Склады»: склад с воротами на юг и запад
  m.fill(41, 39, 57, 49, 0, FLOOR, MAT.SITE);
  wall(m, 45, 41, 56, 48, 4, MAT.BRICK);
  m.fill(45, 41, 56, 48, FLOOR + 4, FLOOR + 4.5, MAT.ROOF);
  m.fill(46, 42, 55, 47, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(49, 41, 52, 42, FLOOR, FLOOR + 3, MAT.AIR); // ворота с юга
  m.fill(45, 43, 46, 46, FLOOR, FLOOR + 3, MAT.AIR); // ворота с запада
  crate(m, 47, 43, 1.5, 1.5, 1);
  crate(m, 52.5, 44.5, 2, 2, 2);
  crate(m, 41, 39, 2, 2, 1);
  crate(m, 42, 46, 1.5, 1.5, 1);

  // Площадь между точками
  crate(m, 25, 43, 2, 2, 1);
  crate(m, 33, 47, 2, 2, 1);
  m.fill(29.5, 45, 30.5, 46, FLOOR, FLOOR + 3, MAT.SAND);

  // Северная стена базы защиты
  wall(m, 1, 51, 6, 52, 6, MAT.PLASTER);
  wall(m, 12, 51, 29, 52, 6, MAT.PLASTER);
  wall(m, 32, 51, 50, 52, 6, MAT.PLASTER);
  wall(m, 56, 51, 59, 52, 6, MAT.PLASTER);
  crate(m, 14, 55, 2, 2, 1);
  crate(m, 44, 54, 2, 2, 1);
  palm(m, 4, 55, 4);

  return {
    id: 'medina',
    name: 'Медина',
    desc: 'Большая: петляющий переулок, крытый базар, длинная улица к складам',
    map: m,
    sites: [siteA, siteB],
    siteNames: ['A', 'B'],
    spawns: [spawnRows(24, 3, 5.5), spawnRows(24, 56, 53.5)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 59, z1: 8 },
      { x0: 1, z0: 52, x1: 59, z1: 59 },
    ],
    mid: [30, 44],
    zones: [
      { name: 'Красильни A', r: siteA },
      { name: 'Склады B', r: siteB },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 59, z1: 8 } },
      { name: 'База защиты', r: { x0: 1, z0: 52, x1: 59, z1: 59 } },
      { name: 'Базар', r: { x0: 24, z0: 8, x1: 36, z1: 40 } },
      { name: 'Переулок', r: { x0: 1, z0: 8, x1: 7, z1: 37 } },
      { name: 'Длинная улица', r: { x0: 47, z0: 8, x1: 59, z1: 37 } },
      { name: 'Площадь', r: { x0: 23, z0: 40, x1: 37, z1: 51 } },
    ],
  };
}
