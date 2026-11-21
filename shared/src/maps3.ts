// Карты для «Союзников» (2×2): уменьшенные переработки больших карт с одной точкой A.
// Нападение на юге, защита на севере. В каждой — три пути к точке (длинный, короткий и через
// соединитель для ротаций), второй ярус, укрытия разной высоты и нет прострела от базы до базы.
// Обе «точки» в MapInfo указывают на одну площадку A — боты и сервер работают без изменений.

import { FLOOR, MAT, VoxelMap, archX, archZ, crate, palm, wall, type MapInfo, type Rect } from './map';

/**
 * Лестница из ступеней по 0,5 м вдоль оси z: верхняя ступень (высотой height) примыкает к zTop,
 * дальше ступени спускаются в сторону dir (−1 — на юг, 1 — на север).
 */
function stairsZ(m: VoxelMap, x0: number, x1: number, zTop: number, dir: 1 | -1, height: number, mat: number = MAT.SAND) {
  const steps = Math.round(height / 0.5);
  for (let k = 0; k < steps; k++) {
    const a = zTop + dir * k * 0.5,
      b = zTop + dir * (k + 1) * 0.5;
    m.fill(x0, Math.min(a, b), x1, Math.max(a, b), FLOOR, FLOOR + height - k * 0.5, mat);
  }
}
/** То же вдоль оси x: верхняя ступень у xTop, спуск в сторону dir. */
function stairsX(m: VoxelMap, z0: number, z1: number, xTop: number, dir: 1 | -1, height: number, mat: number = MAT.SAND) {
  const steps = Math.round(height / 0.5);
  for (let k = 0; k < steps; k++) {
    const a = xTop + dir * k * 0.5,
      b = xTop + dir * (k + 1) * 0.5;
    m.fill(Math.min(a, b), z0, Math.max(a, b), z1, FLOOR, FLOOR + height - k * 0.5, mat);
  }
}

/** Прилавок под навесом. */
function stall(m: VoxelMap, x: number, z: number, w: number, d: number) {
  crate(m, x, z, w, d, 1);
  m.fill(x - 0.5, z - 0.5, x + w + 0.5, z + d + 0.5, FLOOR + 2.5, FLOOR + 3, MAT.WOOD);
  m.fill(x - 0.5, z - 0.5, x, z, FLOOR, FLOOR + 2.5, MAT.WOOD);
  m.fill(x + w, z + d, x + w + 0.5, z + d + 0.5, FLOOR, FLOOR + 2.5, MAT.WOOD);
}

function outer(m: VoxelMap, w: number, d: number, h: number, mat: number) {
  wall(m, 0, 0, w, 1, h, mat);
  wall(m, 0, d - 1, w, d, h, mat);
  wall(m, 0, 0, 1, d, h, mat);
  wall(m, w - 1, 0, w, d, h, mat);
}

function rows(x0: number, z0: number, z1: number): Array<[number, number]> {
  return [
    [x0, z0],
    [x0 + 2.5, z1],
    [x0 + 5, z0],
    [x0 + 1.2, z1],
  ];
}

/**
 * «Рынок» (2×2): 34×38 м по мотивам «Рыночной площади».
 * Точка A на северо-западе. Пути: длинный западный проход, площадь с фонтаном и аркой в точку,
 * проходной дом между ними для ротаций. Защита выходит на площадь через проём в северной стене
 * и в точку — с тыла. На точке помост в 1 м и двойные ящики.
 */
export function buildWmMarket(): MapInfo {
  const W = 34,
    D = 38;
  const m = new VoxelMap(W * 2, 18, D * 2);
  m.fill(0, 0, W, D, 0, FLOOR, MAT.COBBLE);
  outer(m, W, D, 6, MAT.SAND);
  m.fill(13, 2, 22, 6, 0, FLOOR, MAT.TILE);
  m.fill(20, 32, 31, 36, 0, FLOOR, MAT.TILE);

  // Южные ворота площади: два узких прохода, смещены от проёма защиты
  wall(m, 12, 8, 23, 10, 6, MAT.BRICK);
  m.fill(12, 8, 23, 10, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(13, 8, 15, 10, FLOOR, FLOOR + 3, MAT.AIR);
  m.fill(20.5, 8, 22.5, 10, FLOOR, FLOOR + 3, MAT.AIR);
  for (let x = 16; x < 20; x += 2) m.fill(x, 7.5, x + 1, 8, 2.5, 3.5, MAT.DARK);

  // Проходной дом между западным проходом и площадью
  wall(m, 5, 10, 12, 21, 6, MAT.PLASTER);
  m.fill(5, 10, 12, 21, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(6.5, 11.5, 11, 19.5, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(6.5, 11.5, 11, 19.5, 0, FLOOR, MAT.TILE);
  m.fill(5, 16.5, 6.5, 18.5, FLOOR, FLOOR + 2.5, MAT.AIR); // дверь в западный проход
  m.fill(11, 12, 12, 14, FLOOR, FLOOR + 2.5, MAT.AIR); // дверь на площадь
  m.fill(11.5, 17, 12, 18, 2.5, 3.5, MAT.AIR); // окно на площадь
  crate(m, 7, 12, 1.5, 1.5, 1);
  crate(m, 9.5, 18, 1, 1, 1);

  // Стена между домом/проходом и точкой (южный край точки), окно-бойница
  wall(m, 5, 21, 15, 23, 6, MAT.PLASTER);
  m.fill(9, 22.5, 11, 23, 2.5, 3.5, MAT.DARK);

  // Восточный квартал: глухой, с крышей; ниши-окна на площадь
  wall(m, 23, 8, 33, 30, 6, MAT.BRICK);
  m.fill(23, 8, 33, 30, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  for (let z = 12; z < 28; z += 4) m.fill(22.5, z, 23, z + 1, 2.5, 3.5, MAT.DARK);
  // балкон над площадью (только картинка)
  m.fill(22, 16, 23, 22, 3.5, 4, MAT.WOOD);

  // Площадь: L-образная (у точки уже), фонтан, прилавок, ящики
  wall(m, 12, 21, 15, 22, 0.5, MAT.SAND); // бордюр у угла дома
  wall(m, 16, 13.5, 20, 17.5, 1, MAT.SAND);
  m.fill(16.5, 14, 19.5, 17, FLOOR + 0.5, FLOOR + 1, MAT.AIR);
  m.fill(16.5, 14, 19.5, 17, FLOOR, FLOOR + 0.5, MAT.WATER);
  m.fill(17.5, 15, 18.5, 16, FLOOR, FLOOR + 2.5, MAT.SAND);
  stall(m, 20, 24, 2, 1.5);
  crate(m, 13, 11, 1.5, 1.5, 1);
  crate(m, 16, 26.5, 2, 2, 2);
  crate(m, 21, 11.5, 1.5, 1.5, 1);
  palm(m, 21.5, 20, 4);

  // Северная стена площади: проём смещён влево — с южных ворот в базу защиты не видно
  wall(m, 15.5, 30, 33, 31, 6, MAT.BRICK);
  m.fill(17, 30, 19.5, 31, FLOOR, FLOOR + 3, MAT.AIR);
  m.fill(16.5, 31.5, 18, 33, FLOOR, FLOOR + 1, MAT.CRATE); // ящик за проёмом

  // Точка A: стена к площади с аркой, проход защиты с тыла
  const siteA: Rect = { x0: 1, z0: 23, x1: 14, z1: 37 };
  wall(m, 14, 22, 15.5, 37, 6, MAT.SAND);
  archZ(m, 26, 29, 14, 15.5, 3);
  m.fill(14, 33.5, 15.5, 37, FLOOR, FLOOR + 3, MAT.AIR); // вход защиты
  m.fill(3, 26, 12, 34, 0, FLOOR, MAT.SITE);
  // помост (1 м) в глубине точки, на него — две ступени с юга
  m.fill(8, 32, 13.5, 36.5, FLOOR, FLOOR + 1, MAT.WOOD);
  stairsZ(m, 10, 12, 32, -1, 0.5, MAT.WOOD);
  m.fill(8, 36, 13.5, 36.5, FLOOR + 1, FLOOR + 1.5, MAT.WOOD); // бортик
  // двойные ящики, одиночный, низкая стенка и колонна
  crate(m, 4, 28, 2, 2, 2);
  crate(m, 6, 28.5, 1.5, 1.5, 1);
  crate(m, 10.5, 25, 1.5, 1.5, 1);
  wall(m, 1, 33.5, 4, 34, 1, MAT.SAND);
  m.fill(2, 24, 3, 25, FLOOR, FLOOR + 3.5, MAT.SAND);

  // Западный проход: длинный, одно укрытие посередине
  crate(m, 2.5, 15, 1.5, 1.5, 1);
  wall(m, 1, 21.5, 2.5, 22, 1, MAT.SAND);

  // База защиты
  crate(m, 30, 32, 1.5, 1.5, 1);
  palm(m, 31.5, 35.5, 4.5);
  palm(m, 3, 4, 4);

  return {
    id: 'wm_market',
    name: 'Рынок',
    desc: 'Союзники: площадь с фонтаном, арка, проходной дом и помост на точке',
    map: m,
    sites: [siteA, siteA],
    siteNames: ['A', 'A'],
    oneSite: true,
    spawns: [rows(14, 3, 5), rows(23, 35, 33)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 33, z1: 8 },
      { x0: 16, z0: 31, x1: 33, z1: 37 },
    ],
    mid: [18, 24],
    ctRoles: [0, 2],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 33, z1: 8 } },
      { name: 'База защиты', r: { x0: 15.5, z0: 31, x1: 33, z1: 37 } },
      { name: 'Площадь', r: { x0: 12, z0: 10, x1: 23, z1: 30 } },
      { name: 'Дом', r: { x0: 5, z0: 10, x1: 12, z1: 21 } },
      { name: 'Западный проход', r: { x0: 1, z0: 8, x1: 5, z1: 23 } },
      { name: 'Ворота', r: { x0: 12, z0: 8, x1: 23, z1: 10 } },
    ],
  };
}

/**
 * «Переулки» (2×2): 32×34 м по мотивам «Старого квартала». Точка A на северо-востоке — двор с колодцем.
 * Пути: восточная улица (длинный), проходной дом → задний двор → арка в точку (короткий),
 * западный переулок в задний двор (обход дома). Над улицей — плоская крыша с лестницей:
 * с неё видно вход на точку, но крыша открыта из точки.
 */
export function buildWmAlleys(): MapInfo {
  const W = 32,
    D = 34;
  const m = new VoxelMap(W * 2, 18, D * 2);
  m.fill(0, 0, W, D, 0, FLOOR, MAT.COBBLE);
  outer(m, W, D, 7, MAT.PLASTER);

  // Проходной дом
  wall(m, 9, 8, 21, 20, 6, MAT.PLASTER);
  m.fill(9, 8, 21, 20, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(10.5, 9.5, 19.5, 18.5, FLOOR, FLOOR + 3.5, MAT.AIR);
  m.fill(10.5, 9.5, 19.5, 18.5, 0, FLOOR, MAT.TILE);
  m.fill(14, 8, 16, 9.5, FLOOR, FLOOR + 2.5, MAT.AIR); // вход с базы нападения
  m.fill(11, 18.5, 13, 20, FLOOR, FLOOR + 2.5, MAT.AIR); // выход в задний двор
  // перегородка внутри: из входа не видно выход
  wall(m, 10.5, 13.5, 16.5, 14, 2.5, MAT.PLASTER);
  crate(m, 17.5, 15.5, 1.5, 1.5, 1);
  crate(m, 11, 10, 1.5, 1.5, 1);

  // Низкий дом с плоской крышей (3 м) между проходным домом и улицей, лестница с улицы
  wall(m, 21, 11, 26, 20, 3, MAT.SAND);
  m.fill(21, 19.5, 26, 20, FLOOR + 3, FLOOR + 3.5, MAT.SAND); // парапет к точке
  m.fill(23, 19.5, 24, 20, FLOOR + 3, FLOOR + 3.5, MAT.AIR); // щель в парапете
  stairsZ(m, 25, 26, 11, -1, 3, MAT.SAND); // с улицы на крышу: ступени от ворот на север

  // Восточная улица: лавка, повозка
  stall(m, 28, 12, 1.5, 2);
  crate(m, 26.5, 17, 2, 1.5, 1);
  // ворота улицы со стороны нападения — узкий проход у стены
  wall(m, 21, 7, 31, 8, 5, MAT.BRICK);
  m.fill(28.5, 7, 31, 8, FLOOR, FLOOR + 2.5, MAT.AIR);

  // Западный переулок и задний двор
  wall(m, 1, 7, 9, 8, 5, MAT.PLASTER);
  m.fill(1, 7, 3, 8, FLOOR, FLOOR + 2.5, MAT.AIR);
  crate(m, 6.5, 12, 1.5, 1.5, 1);
  crate(m, 1.5, 16, 1.5, 1.5, 2);
  // задний двор (x 1–16, z 20–27): бочки, лестница на сарай
  wall(m, 1, 20, 9, 21, 4, MAT.PLASTER);
  m.fill(4, 20, 6.5, 21, FLOOR, FLOOR + 2.5, MAT.AIR); // проход из переулка
  crate(m, 7, 23, 1.5, 1.5, 1);
  wall(m, 1, 24, 4, 27, 2, MAT.WOOD); // сарай (2 м)
  stairsX(m, 24.5, 26, 4, 1, 2, MAT.WOOD);
  crate(m, 12.5, 24.5, 1.5, 1.5, 1);

  // Стена между двором и базой защиты, дверь для защиты
  wall(m, 1, 27, 17, 28.5, 6, MAT.PLASTER);
  m.fill(9, 27, 11, 28.5, FLOOR, FLOOR + 2.5, MAT.AIR);

  // Точка A (двор с колодцем): стены, арка с запада, вход с тыла от защиты
  const siteA: Rect = { x0: 17, z0: 21, x1: 31, z1: 33 };
  wall(m, 16, 20, 17, 33, 6, MAT.BRICK);
  archZ(m, 22.5, 25.5, 16, 17, 3);
  m.fill(16, 30, 17, 33, FLOOR, FLOOR + 3, MAT.AIR); // вход защиты
  wall(m, 17, 20, 21, 21, 6, MAT.BRICK); // угол между домом и крышей
  m.fill(19, 23, 29, 31, 0, FLOOR, MAT.SITE);
  // колодец, прилавок, штабель, низкая стенка
  wall(m, 23, 25, 25.5, 27.5, 1, MAT.SAND);
  m.fill(23.5, 25.5, 25, 27, FLOOR + 0.5, FLOOR + 1, MAT.WATER);
  for (const [x, z] of [
    [22.5, 24.5],
    [25.5, 27.5],
  ])
    m.fill(x, z, x + 0.5, z + 0.5, FLOOR, FLOOR + 3, MAT.WOOD);
  m.fill(22.5, 24.5, 26, 28, FLOOR + 3, FLOOR + 3.5, MAT.ROOF);
  stall(m, 28.5, 22, 1.5, 1.5);
  crate(m, 19, 28.5, 2, 2, 2);
  crate(m, 21, 29, 1.5, 1.5, 1);
  wall(m, 27, 31, 31, 31.5, 1, MAT.SAND);
  palm(m, 30, 32, 4);

  // База защиты
  crate(m, 1.5, 29, 1.5, 1.5, 1);
  crate(m, 13, 31, 1.5, 1.5, 1);

  return {
    id: 'wm_alleys',
    name: 'Переулки',
    desc: 'Союзники: тесно — проходной дом, задний двор, улица и крыша над входом на точку',
    map: m,
    sites: [siteA, siteA],
    siteNames: ['A', 'A'],
    oneSite: true,
    spawns: [rows(10, 2.5, 4.5), rows(4, 32, 30)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 31, z1: 7 },
      { x0: 1, z0: 28.5, x1: 16, z1: 33 },
    ],
    mid: [10, 23],
    ctRoles: [0, 2],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 31, z1: 7 } },
      { name: 'База защиты', r: { x0: 1, z0: 28.5, x1: 16, z1: 33 } },
      { name: 'Проходной дом', r: { x0: 9, z0: 8, x1: 21, z1: 20 } },
      { name: 'Крыша', r: { x0: 21, z0: 11, x1: 26, z1: 20 } },
      { name: 'Улица', r: { x0: 26, z0: 8, x1: 31, z1: 21 } },
      { name: 'Переулок', r: { x0: 1, z0: 8, x1: 9, z1: 20 } },
      { name: 'Задний двор', r: { x0: 1, z0: 20, x1: 16, z1: 27 } },
    ],
  };
}

/**
 * «Караван» (2×2): 34×34 м по мотивам «Караван-сарая». Точка A в центре на севере.
 * Пути: западный крытый туннель (зигзаг), центральные ворота во двор с колодцем,
 * восточная галерея с деревянным настилом на 2 м. Защита выходит из-за северной стены
 * через два проёма по краям точки.
 */
export function buildWmCaravan(): MapInfo {
  const W = 34,
    D = 34;
  const m = new VoxelMap(W * 2, 18, D * 2);
  m.fill(0, 0, W, D, 0, FLOOR, MAT.COBBLE);
  outer(m, W, D, 7, MAT.SAND);
  for (const [x, z] of [
    [0, 0],
    [31, 0],
    [0, 31],
    [31, 31],
  ]) {
    wall(m, x, z, x + 3, z + 3, 9, MAT.SAND);
    m.fill(x, z, x + 3, z + 3, FLOOR + 9, FLOOR + 9.5, MAT.ROOF);
  }
  m.fill(12, 2, 22, 6, 0, FLOOR, MAT.TILE);

  // Западный квартал с зигзагом крытого туннеля
  wall(m, 1, 8, 10, 21, 6, MAT.BRICK);
  m.fill(1, 8, 10, 21, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  const tunnel: Array<[number, number, number, number]> = [
    [3, 8, 6, 14],
    [3, 11.5, 9, 14.5],
    [6.5, 11.5, 9, 21],
  ];
  for (const [x0, z0, x1, z1] of tunnel) {
    m.fill(x0, z0, x1, z1, FLOOR, FLOOR + 3, MAT.AIR);
    m.fill(x0, z0, x1, z1, 0, FLOOR, MAT.DARK);
  }
  crate(m, 3.5, 12, 1, 1, 1);
  crate(m, 7, 17, 1.5, 1.5, 1);

  // Центральные ворота: длинный узкий проход во двор
  wall(m, 10, 8, 25, 14, 6, MAT.SAND);
  m.fill(10, 8, 25, 14, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  archX(m, 15.5, 18, 8, 14, 3);
  for (let x = 11; x < 25; x += 4) if (x < 15 || x > 18) m.fill(x, 7.5, x + 1, 8, 2.5, 3.5, MAT.DARK);

  // Двор с колодцем под навесом
  wall(m, 16, 16, 19, 19, 1, MAT.SAND);
  m.fill(16.5, 16.5, 18.5, 18.5, FLOOR + 0.5, FLOOR + 1, MAT.WATER);
  for (const [x, z] of [
    [15.5, 15.5],
    [19, 15.5],
    [15.5, 19],
    [19, 19],
  ])
    m.fill(x, z, x + 0.5, z + 0.5, FLOOR, FLOOR + 3.5, MAT.WOOD);
  m.fill(15.5, 15.5, 19.5, 19.5, FLOOR + 3.5, FLOOR + 4, MAT.ROOF);
  crate(m, 11, 15, 2, 2, 1);
  crate(m, 22, 17.5, 1.5, 1.5, 2);

  // Восточная галерея: стена ко двору с одним проёмом, колонны, настил на 2 м с лестницей
  wall(m, 25, 8, 26.5, 21, 6, MAT.PLASTER);
  m.fill(25, 16.5, 26.5, 18.5, FLOOR, FLOOR + 2.5, MAT.AIR); // соединитель со двором
  for (let z = 9; z < 21; z += 3) m.fill(28, z, 28.5, z + 0.5, FLOOR, FLOOR + 4, MAT.SAND);
  m.fill(30, 11, 33, 21, FLOOR, FLOOR + 2, MAT.WOOD); // настил
  m.fill(30, 11, 30.5, 21, FLOOR + 2, FLOOR + 2.5, MAT.WOOD); // перила
  m.fill(30, 14, 30.5, 15, FLOOR + 2, FLOOR + 2.5, MAT.AIR); // щель в перилах
  stairsZ(m, 31, 33, 11, -1, 2, MAT.WOOD); // ступени на юг от настила
  crate(m, 26.5, 12, 1.5, 1.5, 1);

  // Точка A между двором и базой защиты
  const siteA: Rect = { x0: 9, z0: 21, x1: 26, z1: 29 };
  m.fill(11, 22, 24, 28, 0, FLOOR, MAT.SITE);
  // будка в центре точки (3 м) с крышей
  wall(m, 15.5, 24, 18.5, 26.5, 3, MAT.PLASTER);
  m.fill(15, 23.5, 19, 27, FLOOR + 3, FLOOR + 3.5, MAT.ROOF);
  crate(m, 10, 22, 2, 2, 2);
  crate(m, 12, 22.5, 1.5, 1.5, 1);
  crate(m, 22, 26.5, 2, 1.5, 1);
  wall(m, 20.5, 22, 24, 22.5, 1, MAT.SAND);
  m.fill(24.5, 27, 25.5, 28, FLOOR, FLOOR + 3.5, MAT.SAND); // колонна

  // Западный и восточный подходы к точке: стенки-заслоны
  wall(m, 1, 22.5, 4, 23, 1, MAT.SAND);
  crate(m, 5, 26, 1.5, 1.5, 1);
  crate(m, 28.5, 24, 1.5, 1.5, 1);
  palm(m, 31, 27, 4.5);

  // Северная стена: два проёма защиты по краям, по центру — глухо (нет прострела)
  wall(m, 1, 29, 33, 30, 6, MAT.BRICK);
  m.fill(9, 29, 12, 30, FLOOR, FLOOR + 3, MAT.AIR);
  m.fill(23, 29, 26, 30, FLOOR, FLOOR + 3, MAT.AIR);
  for (let x = 14; x < 22; x += 3) m.fill(x, 28.5, x + 1, 29, 2.5, 3.5, MAT.DARK);
  // за восточным проёмом — заслон, чтобы галерея не простреливала базу
  wall(m, 26.5, 30.5, 28, 32, 2, MAT.SAND);

  return {
    id: 'wm_caravan',
    name: 'Караван',
    desc: 'Союзники: крытый туннель, ворота во двор, галерея с настилом и будка на точке',
    map: m,
    sites: [siteA, siteA],
    siteNames: ['A', 'A'],
    oneSite: true,
    spawns: [rows(13, 3, 5), rows(14, 32.5, 31)],
    spawnZones: [
      { x0: 1, z0: 1, x1: 33, z1: 8 },
      { x0: 1, z0: 30, x1: 33, z1: 33 },
    ],
    mid: [17.5, 18],
    ctRoles: [0, 2],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 33, z1: 8 } },
      { name: 'База защиты', r: { x0: 1, z0: 30, x1: 33, z1: 33 } },
      { name: 'Туннель', r: { x0: 1, z0: 8, x1: 10, z1: 21 } },
      { name: 'Ворота', r: { x0: 10, z0: 8, x1: 25, z1: 14 } },
      { name: 'Двор', r: { x0: 10, z0: 14, x1: 25, z1: 21 } },
      { name: 'Галерея', r: { x0: 26.5, z0: 8, x1: 33, z1: 21 } },
      { name: 'Западный подход', r: { x0: 1, z0: 21, x1: 9, z1: 29 } },
      { name: 'Восточный подход', r: { x0: 26, z0: 21, x1: 33, z1: 29 } },
    ],
  };
}
