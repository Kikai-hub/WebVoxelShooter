// Воксельная карта (блоки 0,5 м) и генератор карты «Рыночная площадь».
// Планировка своя: две точки бомбы, три маршрута, центр для ротаций.

export const VOXEL = 0.5;

export const MAT = {
  AIR: 0,
  SAND: 1, // песчаник
  BRICK: 2, // кирпич
  COBBLE: 3, // брусчатка
  CRATE: 4, // ящик
  DARK: 5, // тёмный камень (ниши)
  SITE: 6, // разметка точки
  TRUNK: 7, // ствол пальмы
  LEAVES: 8, // листья
  WATER: 9, // вода фонтана
  TILE: 10, // плитка
  PLASTER: 11, // штукатурка
  WOOD: 12, // доски балконов
  METAL: 13, // металл
  ROOF: 14, // черепица
} as const;
export const MAT_COUNT = 15;

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

export class VoxelMap {
  readonly data: Uint8Array;
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {
    this.data = new Uint8Array(sx * sy * sz);
  }
  idx(x: number, y: number, z: number): number {
    return x + this.sx * (z + this.sz * y);
  }
  /** За пределами по горизонтали и ниже пола — сплошной блок, выше карты — воздух. */
  get(x: number, y: number, z: number): number {
    if (y >= this.sy) return 0;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y < 0) return MAT.SAND;
    return this.data[x + this.sx * (z + this.sz * y)];
  }
  set(x: number, y: number, z: number, m: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    this.data[x + this.sx * (z + this.sz * y)] = m;
  }
  solidAt(wx: number, wy: number, wz: number): boolean {
    return this.get(Math.floor(wx / VOXEL), Math.floor(wy / VOXEL), Math.floor(wz / VOXEL)) !== 0;
  }
  /** Заполнить параллелепипед в воксельных координатах [x0,x1) и т.д. */
  fillV(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.set(x, y, z, m);
  }
  /** То же в метрах (по горизонтали x,z, по высоте y). */
  fill(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: number): void {
    const v = (n: number) => Math.round(n / VOXEL);
    this.fillV(v(x0), v(y0), v(z0), v(x1), v(y1), v(z1), m);
  }
  get width(): number {
    return this.sx * VOXEL;
  }
  get depth(): number {
    return this.sz * VOXEL;
  }
}

export interface MapInfo {
  id: string;
  name: string;
  map: VoxelMap;
  sites: [Rect, Rect]; // A, B
  siteNames: [string, string];
  spawns: [Array<[number, number]>, Array<[number, number]>]; // по командам T, CT
  spawnZones: [Rect, Rect];
  /** Позиция «середины» для ботов-защитников и разделения атаки. */
  mid: [number, number];
  /** Именованные зоны для миникарты. */
  zones: Array<{ name: string; r: Rect }>;
}

const FLOOR = 0.5; // верх пола в метрах

function wall(m: VoxelMap, x0: number, z0: number, x1: number, z1: number, h: number, mat: number) {
  m.fill(x0, z0, x1, z1, FLOOR, FLOOR + h, mat);
}

function crate(m: VoxelMap, x: number, z: number, w: number, d: number, h: number) {
  m.fill(x, z, x + w, z + d, FLOOR, FLOOR + h, MAT.CRATE);
}

function palm(m: VoxelMap, x: number, z: number, h: number) {
  m.fill(x, z, x + 0.5, z + 0.5, FLOOR, FLOOR + h, MAT.TRUNK);
  const top = FLOOR + h;
  m.fill(x - 1, z - 1, x + 1.5, z + 1.5, top, top + 0.5, MAT.LEAVES);
  m.fill(x - 2, z, x + 2.5, z + 0.5, top - 0.5, top, MAT.LEAVES);
  m.fill(x, z - 2, x + 0.5, z + 2.5, top - 0.5, top, MAT.LEAVES);
  m.fill(x, z, x + 0.5, z + 0.5, top + 0.5, top + 1, MAT.LEAVES);
}

/** Арка: проём в стене высотой h с полукруглым верхом из блоков. */
function archX(m: VoxelMap, x0: number, x1: number, z0: number, z1: number, h: number) {
  m.fill(x0, z0, x1, z1, FLOOR, FLOOR + h, MAT.AIR);
  m.fill(x0 + 0.5, z0, x1 - 0.5, z1, FLOOR + h, FLOOR + h + 0.5, MAT.AIR);
}
function archZ(m: VoxelMap, z0: number, z1: number, x0: number, x1: number, h: number) {
  m.fill(x0, z0, x1, z1, FLOOR, FLOOR + h, MAT.AIR);
  m.fill(x0, z0 + 0.5, x1, z1 - 0.5, FLOOR + h, FLOOR + h + 0.5, MAT.AIR);
}

/** Карта «Рыночная площадь»: 48×48 м. Нападение на юге, защита на севере. */
export function buildMarketSquare(): MapInfo {
  const m = new VoxelMap(96, 18, 96);
  // Пол
  m.fill(0, 0, 48, 48, 0, FLOOR, MAT.COBBLE);

  // Внешние стены и угловые башни
  wall(m, 0, 0, 48, 1, 6, MAT.SAND);
  wall(m, 0, 47, 48, 48, 6, MAT.SAND);
  wall(m, 0, 0, 1, 48, 6, MAT.SAND);
  wall(m, 47, 0, 48, 48, 6, MAT.SAND);
  for (const [x, z] of [
    [0, 0],
    [45, 0],
    [0, 45],
    [45, 45],
  ]) {
    wall(m, x, z, x + 3, z + 3, 8, MAT.SAND);
    m.fill(x, z, x + 3, z + 3, FLOOR + 8, FLOOR + 8.5, MAT.ROOF);
  }

  // Западный и восточный дома между южным коридором и точками
  wall(m, 7, 10, 17, 26, 6, MAT.PLASTER);
  wall(m, 31, 10, 41, 26, 6, MAT.PLASTER);
  m.fill(7, 10, 17, 26, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  m.fill(31, 10, 41, 26, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);

  // Стены между площадью и точками с арками
  wall(m, 15, 26, 17, 40, 6, MAT.SAND);
  wall(m, 31, 26, 33, 40, 6, MAT.SAND);
  archZ(m, 31, 34, 15, 17, 3);
  archZ(m, 31, 34, 31, 33, 3);

  // Северная стена (между точками/площадью и базой защиты)
  wall(m, 1, 40, 4, 41, 6, MAT.BRICK);
  wall(m, 9, 40, 39, 41, 6, MAT.BRICK);
  wall(m, 44, 40, 47, 41, 6, MAT.BRICK);
  // арка смещена от оси площади, чтобы не было прострела от базы до базы
  archX(m, 18, 21, 40, 41, 3);

  // Южные ворота площади: закрывают линию обзора с базы нападения
  wall(m, 20, 9, 28, 11, 6, MAT.BRICK);
  m.fill(20, 9, 28, 11, FLOOR + 6, FLOOR + 6.5, MAT.ROOF);
  for (let x = 21; x < 28; x += 3) m.fill(x, 8.5, x + 1, 9, 2.5, 3.5, MAT.DARK);

  // Ниши-окна и балконы на фасадах площади
  for (let z = 12; z < 25; z += 4) {
    m.fill(16.5, z, 17, z + 1, 2.5, 3.5, MAT.DARK);
    m.fill(31, z, 31.5, z + 1, 2.5, 3.5, MAT.DARK);
  }
  m.fill(17, 14, 17.5, 22, 3.5, 4, MAT.WOOD);
  m.fill(30.5, 14, 31, 22, 3.5, 4, MAT.WOOD);
  for (let x = 10; x < 38; x += 5) if (x < 17 || x > 22) m.fill(x, 39.5, x + 1, 40, 2.5, 3.5, MAT.DARK);

  // Точка A (северо-запад) и B (северо-восток)
  const siteA: Rect = { x0: 2, z0: 28, x1: 14, z1: 39 };
  const siteB: Rect = { x0: 34, z0: 28, x1: 46, z1: 39 };
  m.fill(4, 31, 12, 37, 0, FLOOR, MAT.SITE);
  m.fill(36, 31, 44, 37, 0, FLOOR, MAT.SITE);
  // Укрытия на A
  crate(m, 4, 30, 2, 2, 1);
  crate(m, 9, 35, 2, 2, 2);
  crate(m, 11, 29, 1.5, 1.5, 1);
  wall(m, 2, 37, 5, 37.5, 1, MAT.SAND);
  // Укрытия на B (не зеркально, чтобы точки различались)
  crate(m, 42, 30, 2, 2, 2);
  crate(m, 37, 35, 2, 2, 1);
  crate(m, 35.5, 29, 1.5, 1.5, 1);
  wall(m, 43, 37, 46, 37.5, 1, MAT.SAND);

  // Укрытия в боковых проходах
  crate(m, 3, 18, 2, 2, 1);
  crate(m, 43, 15, 2, 2, 1);
  crate(m, 2, 24, 1.5, 1.5, 1);
  crate(m, 44.5, 22, 1.5, 1.5, 1);

  // Площадь: фонтан и ящики
  wall(m, 21, 21, 27, 27, 1, MAT.SAND);
  m.fill(21.5, 21.5, 26.5, 26.5, FLOOR + 0.5, FLOOR + 1, MAT.AIR);
  m.fill(21.5, 21.5, 26.5, 26.5, FLOOR, FLOOR + 0.5, MAT.WATER);
  m.fill(23.5, 23.5, 24.5, 24.5, FLOOR, FLOOR + 2.5, MAT.SAND);
  crate(m, 18, 14, 2, 2, 1);
  crate(m, 27, 29.5, 2, 2, 2);
  crate(m, 19, 33, 1.5, 1.5, 1);
  crate(m, 27.5, 16, 1.5, 1.5, 1);
  m.fill(23, 36, 27, 37, FLOOR, FLOOR + 1, MAT.TILE); // скамья-парапет

  // Базы
  m.fill(18, 2, 30, 6, 0, FLOOR, MAT.TILE);
  m.fill(18, 42, 30, 46, 0, FLOOR, MAT.TILE);
  crate(m, 12, 3, 2, 2, 1);
  crate(m, 34, 4, 2, 2, 1);
  crate(m, 11, 43, 2, 2, 1);
  crate(m, 35, 44, 2, 2, 1);

  // Пальмы
  palm(m, 19.5, 38, 4);
  palm(m, 28, 11, 4);
  palm(m, 6, 44.5, 4.5);
  palm(m, 41.5, 44.5, 4.5);
  palm(m, 3, 4, 4);
  palm(m, 44, 7, 4);

  const spawnsT: Array<[number, number]> = [];
  const spawnsCT: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    spawnsT.push([19.5 + i * 2.25, 3], [20.5 + i * 2.25, 5]);
    spawnsCT.push([19.5 + i * 2.25, 45], [20.5 + i * 2.25, 43]);
  }

  return {
    id: 'market',
    name: 'Рыночная площадь',
    map: m,
    sites: [siteA, siteB],
    siteNames: ['A', 'B'],
    spawns: [spawnsT, spawnsCT],
    spawnZones: [
      { x0: 1, z0: 1, x1: 47, z1: 9 },
      { x0: 1, z0: 41, x1: 47, z1: 47 },
    ],
    mid: [24, 33],
    zones: [
      { name: 'Точка A', r: siteA },
      { name: 'Точка B', r: siteB },
      { name: 'База нападения', r: { x0: 1, z0: 1, x1: 47, z1: 10 } },
      { name: 'База защиты', r: { x0: 1, z0: 41, x1: 47, z1: 47 } },
      { name: 'Площадь', r: { x0: 17, z0: 10, x1: 31, z1: 40 } },
      { name: 'Западный проход', r: { x0: 1, z0: 10, x1: 7, z1: 28 } },
      { name: 'Восточный проход', r: { x0: 41, z0: 10, x1: 47, z1: 28 } },
    ],
  };
}

export function zoneName(info: MapInfo, x: number, z: number): string {
  for (const zn of info.zones) if (inRect(zn.r, x, z)) return zn.name;
  return '';
}

/** Список карт. Пока одна, голосование появится вместе с двумя другими картами. */
export const MAPS: Record<string, () => MapInfo> = {
  market: buildMarketSquare,
};
