// Оружие: характеристики общие для сервера, клиента и меню снаряжения.

import { rand01 } from './rng';
import { BTN_SCOPE, DT } from './constants';

export const SLOT_PRIMARY = 0;
export const SLOT_PISTOL = 1;
export const SLOT_KNIFE = 2;
/** Слоты гранат: 3 — осколочная, 4 — светошумовая, 5 — дымовая, 6 — зажигательная (молотов) */
export const SLOT_HE = 3;
export const SLOT_FLASH = 4;
export const SLOT_SMOKE = 5;
export const SLOT_FIRE = 6;
export const SLOT_NAMES = ['Основное', 'Пистолет', 'Нож', 'Осколочная', 'Светошумовая', 'Дымовая', 'Зажигательная'];
/** Типы гранат (индекс = номер типа и смещение слота от SLOT_HE). */
export const NADE_TYPES = ['he', 'flash', 'smoke', 'fire'] as const;
export type NadeType = (typeof NADE_TYPES)[number];
export const NADE_COUNT = NADE_TYPES.length;
/** сколько гранат каждого типа можно нести */
export const NADE_LIMIT: Record<NadeType, number> = { he: 1, flash: 2, smoke: 1, fire: 1 };
/** Ключ покупки → тип гранаты (у зажигательной две версии: молотов у атаки, граната у защиты). */
export const NADE_BUY: Record<string, number> = { he: 0, flash: 1, smoke: 2, molotov: 3, incgrenade: 3 };

export interface WeaponDef {
  id: number;
  key: string;
  name: string;
  kind: 'knife' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'grenade';
  slot: number;
  price: number;
  damage: number;
  /** секунд между выстрелами */
  interval: number;
  mag: number;
  reserve: number;
  reload: number;
  /** базовый разброс, рад */
  spread: number;
  /** добавка к разбросу на полной скорости бега */
  moveSpread: number;
  /** рост разброса за выстрел в очереди */
  recoil: number;
  recoilMax: number;
  range: number;
  /** доля урона, проходящая через броню */
  armorPen: number;
  auto: boolean;
  pellets: number;
  killReward: number;
  /** множитель скорости бега */
  speed: number;
  /** доля урона, остающаяся после каждых 10 м полёта пули: урон × falloff^(дальность / 10) */
  falloff: number;
  /**
   * Шанс разрыва головы при убийстве в голову (0..1). Задаётся таблицей `HEAD_EXPLODE` ниже.
   * У дробовика это шанс при 3+ дробинах в голову вблизи: меньше дробин и больше дальность — меньше шанс.
   */
  headExplode: number;
  /** продаётся только этой стороне (0 — атака, 1 — защита) */
  team?: 0 | 1;
  /**
   * Паттерн очереди: смещение [вправо, вверх] в радианах для N-го выстрела серии
   * (0 — первый выстрел, всегда [0, 0]). Пустой — старая модель: только растущий круг разброса.
   * Строится генератором `makePattern` по `SPRAY` ниже.
   */
  pattern: [number, number][];
}

// Ключи (osa, vikhr…) — внутренние и хранятся в снаряжении игроков: не менять. Названия — реальные.
const RAW_WEAPONS: Omit<WeaponDef, 'pattern' | 'headExplode'>[] = [
  { id: 0, key: 'knife', name: 'Нож', kind: 'knife', slot: SLOT_KNIFE, price: 0, damage: 45, interval: 0.55, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 1.9, armorPen: 0.85, auto: true, pellets: 1, killReward: 1500, speed: 1.05, falloff: 1 },
  { id: 1, key: 'osa', name: 'Glock-17', kind: 'pistol', slot: SLOT_PISTOL, price: 0, damage: 28, interval: 0.15, mag: 20, reserve: 100, reload: 2.2, spread: 0.006, moveSpread: 0.03, recoil: 0.012, recoilMax: 0.05, range: 200, armorPen: 0.5, auto: false, pellets: 1, killReward: 300, speed: 1.02, falloff: 0.8 },
  { id: 2, key: 'gyurza', name: 'Desert Eagle', kind: 'pistol', slot: SLOT_PISTOL, price: 700, damage: 55, interval: 0.26, mag: 7, reserve: 35, reload: 2.2, spread: 0.005, moveSpread: 0.05, recoil: 0.03, recoilMax: 0.08, range: 200, armorPen: 0.9, auto: false, pellets: 1, killReward: 300, speed: 1.0, falloff: 0.85 },
  { id: 3, key: 'shmel', name: 'MP5', kind: 'smg', slot: SLOT_PRIMARY, price: 1250, damage: 26, interval: 0.075, mag: 30, reserve: 120, reload: 2.4, spread: 0.01, moveSpread: 0.02, recoil: 0.006, recoilMax: 0.06, range: 200, armorPen: 0.6, auto: true, pellets: 1, killReward: 600, speed: 0.97, falloff: 0.85 },
  { id: 4, key: 'molot', name: 'Remington 870', kind: 'shotgun', slot: SLOT_PRIMARY, price: 1100, damage: 22, interval: 0.9, mag: 7, reserve: 32, reload: 3.0, spread: 0.065, moveSpread: 0.02, recoil: 0.02, recoilMax: 0.04, range: 40, armorPen: 0.5, auto: false, pellets: 8, killReward: 900, speed: 0.88, falloff: 0.5 },
  { id: 5, key: 'vikhr', name: 'АК-47', kind: 'rifle', slot: SLOT_PRIMARY, price: 2700, damage: 35, interval: 0.1, mag: 30, reserve: 90, reload: 2.5, spread: 0.003, moveSpread: 0.08, recoil: 0.008, recoilMax: 0.07, range: 300, armorPen: 0.78, auto: true, pellets: 1, killReward: 300, speed: 0.86, falloff: 0.97 },
  { id: 7, key: 'he', name: 'Осколочная граната', kind: 'grenade', slot: SLOT_HE, price: 300, damage: 98, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0.57, auto: false, pellets: 1, killReward: 300, speed: 1, falloff: 1 },
  { id: 8, key: 'flash', name: 'Светошумовая граната', kind: 'grenade', slot: SLOT_FLASH, price: 200, damage: 0, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0, auto: false, pellets: 1, killReward: 0, speed: 1, falloff: 1 },
  { id: 9, key: 'smoke', name: 'Дымовая граната', kind: 'grenade', slot: SLOT_SMOKE, price: 300, damage: 0, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0, auto: false, pellets: 1, killReward: 0, speed: 1, falloff: 1 },
  // Зажигательные: один эффект (огонь), две версии — у атаки «Молотов», у защиты граната подороже
  { id: 10, key: 'molotov', name: 'Коктейль Молотова', kind: 'grenade', slot: SLOT_FIRE, price: 400, damage: 40, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 1, auto: false, pellets: 1, killReward: 300, speed: 1, falloff: 1, team: 0 },
  { id: 11, key: 'incgrenade', name: 'Зажигательная граната', kind: 'grenade', slot: SLOT_FIRE, price: 600, damage: 40, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 1, auto: false, pellets: 1, killReward: 300, speed: 1, falloff: 1, team: 1 },
  // Пистолеты
  { id: 12, key: 'beretta', name: 'Beretta 92', kind: 'pistol', slot: SLOT_PISTOL, price: 300, damage: 30, interval: 0.14, mag: 15, reserve: 90, reload: 2.2, spread: 0.006, moveSpread: 0.035, recoil: 0.014, recoilMax: 0.06, range: 200, armorPen: 0.55, auto: false, pellets: 1, killReward: 300, speed: 1.02, falloff: 0.8 },
  { id: 13, key: 'python', name: 'Colt Python', kind: 'pistol', slot: SLOT_PISTOL, price: 600, damage: 48, interval: 0.3, mag: 6, reserve: 36, reload: 2.8, spread: 0.005, moveSpread: 0.05, recoil: 0.035, recoilMax: 0.09, range: 200, armorPen: 0.85, auto: false, pellets: 1, killReward: 300, speed: 1.0, falloff: 0.85 },
  { id: 14, key: 'sw29', name: 'S&W Model 29', kind: 'pistol', slot: SLOT_PISTOL, price: 800, damage: 70, interval: 0.5, mag: 6, reserve: 30, reload: 3.0, spread: 0.004, moveSpread: 0.06, recoil: 0.05, recoilMax: 0.1, range: 200, armorPen: 0.93, auto: false, pellets: 1, killReward: 300, speed: 1.0, falloff: 0.85 },
  // Пистолеты-пулемёты
  { id: 15, key: 'mac10', name: 'MAC-10', kind: 'smg', slot: SLOT_PRIMARY, price: 1050, damage: 24, interval: 0.066, mag: 30, reserve: 100, reload: 2.6, spread: 0.014, moveSpread: 0.02, recoil: 0.007, recoilMax: 0.07, range: 200, armorPen: 0.57, auto: true, pellets: 1, killReward: 600, speed: 0.98, falloff: 0.8 },
  { id: 16, key: 'ump', name: 'UMP-45', kind: 'smg', slot: SLOT_PRIMARY, price: 1200, damage: 31, interval: 0.09, mag: 25, reserve: 100, reload: 3.0, spread: 0.01, moveSpread: 0.02, recoil: 0.008, recoilMax: 0.065, range: 200, armorPen: 0.65, auto: true, pellets: 1, killReward: 600, speed: 0.95, falloff: 0.85 },
  { id: 17, key: 'skorpion', name: 'Скорпион vz. 61', kind: 'smg', slot: SLOT_PRIMARY, price: 900, damage: 22, interval: 0.06, mag: 20, reserve: 100, reload: 2.2, spread: 0.013, moveSpread: 0.015, recoil: 0.006, recoilMax: 0.06, range: 200, armorPen: 0.5, auto: true, pellets: 1, killReward: 600, speed: 0.98, falloff: 0.8 },
  // Дробовик
  { id: 18, key: 'sawedoff', name: 'Обрез', kind: 'shotgun', slot: SLOT_PRIMARY, price: 1100, damage: 26, interval: 0.85, mag: 7, reserve: 32, reload: 3.0, spread: 0.09, moveSpread: 0.02, recoil: 0.02, recoilMax: 0.04, range: 25, armorPen: 0.7, auto: false, pellets: 8, killReward: 900, speed: 0.92, falloff: 0.5 },
  // Винтовки
  { id: 19, key: 'm4a1', name: 'M4A1', kind: 'rifle', slot: SLOT_PRIMARY, price: 2900, damage: 33, interval: 0.09, mag: 30, reserve: 90, reload: 2.6, spread: 0.0025, moveSpread: 0.08, recoil: 0.007, recoilMax: 0.06, range: 300, armorPen: 0.7, auto: true, pellets: 1, killReward: 300, speed: 0.88, falloff: 0.97 },
  { id: 20, key: 'aug', name: 'Steyr AUG', kind: 'rifle', slot: SLOT_PRIMARY, price: 3300, damage: 32, interval: 0.09, mag: 30, reserve: 90, reload: 3.0, spread: 0.0018, moveSpread: 0.085, recoil: 0.0065, recoilMax: 0.055, range: 300, armorPen: 0.9, auto: true, pellets: 1, killReward: 300, speed: 0.87, falloff: 0.98 },
  // Снайперская
  { id: 21, key: 'awm', name: 'AWM', kind: 'sniper', slot: SLOT_PRIMARY, price: 5000, damage: 130, interval: 1.5, mag: 5, reserve: 30, reload: 3.7, spread: 0.0007, moveSpread: 0.16, recoil: 0.05, recoilMax: 0.05, range: 500, armorPen: 0.97, auto: false, pellets: 1, killReward: 100, speed: 0.78, falloff: 0.99 },
  { id: 6, key: 'sokol', name: 'Мосин-Наган', kind: 'sniper', slot: SLOT_PRIMARY, price: 4750, damage: 115, interval: 1.4, mag: 5, reserve: 30, reload: 3.6, spread: 0.0008, moveSpread: 0.15, recoil: 0.05, recoilMax: 0.05, range: 500, armorPen: 0.97, auto: false, pellets: 1, killReward: 100, speed: 0.8, falloff: 0.99 },
];

/**
 * Параметры паттерна очереди (генератор `makePattern`), радианы:
 * - rise — на сколько поднимется прицел к концу подъёма; riseShots — за сколько выстрелов
 *   он наберёт ~63% подъёма (экспонента: сначала резко вверх, потом полка);
 * - amp — амплитуда «змейки» влево-вправо, period — её период в выстрелах,
 *   start — с какого выстрела начинается змейка (до неё — почти чистый подъём),
 *   side — в какую сторону первый уход (1 — вправо, -1 — влево);
 * - lean — постоянный крен вбок на каждый выстрел подъёма (у каждого ствола свой характер).
 * Мелкая детерминированная «дрожь» добавляется по id оружия, чтобы паттерны не были идеальными синусоидами.
 * Автоматы и ПП — выраженный паттерн, пистолеты — только подъём при частой стрельбе;
 * дробовики и снайперки — без паттерна (старая модель).
 */
export interface SpraySpec {
  rise: number;
  riseShots: number;
  amp: number;
  period: number;
  start: number;
  side: 1 | -1;
  lean: number;
}

const SPRAY: Record<string, SpraySpec> = {
  // винтовки: сильный подъём, широкая медленная змейка
  vikhr: { rise: 0.085, riseShots: 4.5, amp: 0.034, period: 13, start: 8, side: -1, lean: 0.0012 },
  m4a1: { rise: 0.068, riseShots: 4.5, amp: 0.026, period: 12, start: 9, side: 1, lean: -0.0008 },
  aug: { rise: 0.064, riseShots: 5, amp: 0.022, period: 14, start: 10, side: -1, lean: 0.001 },
  // ПП: подъём меньше, змейка частая
  shmel: { rise: 0.05, riseShots: 4, amp: 0.024, period: 9, start: 6, side: 1, lean: 0.0006 },
  mac10: { rise: 0.058, riseShots: 3.5, amp: 0.034, period: 7, start: 5, side: -1, lean: -0.0012 },
  ump: { rise: 0.056, riseShots: 4, amp: 0.028, period: 10, start: 6, side: 1, lean: 0.001 },
  skorpion: { rise: 0.045, riseShots: 3, amp: 0.03, period: 6, start: 4, side: -1, lean: 0.0005 },
  // пистолеты: только подъём при частой стрельбе (без змейки), первый выстрел точный
  osa: { rise: 0.05, riseShots: 5, amp: 0, period: 10, start: 99, side: 1, lean: 0.0006 },
  beretta: { rise: 0.055, riseShots: 5, amp: 0, period: 10, start: 99, side: -1, lean: -0.0006 },
  python: { rise: 0.09, riseShots: 3, amp: 0, period: 10, start: 99, side: 1, lean: 0.001 },
  gyurza: { rise: 0.1, riseShots: 3, amp: 0, period: 10, start: 99, side: -1, lean: -0.001 },
  sw29: { rise: 0.11, riseShots: 2.5, amp: 0, period: 10, start: 99, side: 1, lean: 0.001 },
};

/** Сгенерировать паттерн на n выстрелов: [вправо, вверх] в радианах. */
export function makePattern(spec: SpraySpec, n: number, salt: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const up = spec.rise * (1 - Math.exp(-i / spec.riseShots));
    // змейка включается плавно за 3 выстрела после start
    const k = Math.max(0, Math.min(1, (i - spec.start + 3) / 3));
    const ph = ((i - spec.start) / spec.period) * Math.PI * 2;
    const jitter = i === 0 ? 0 : (rand01(salt * 7919 + i * 104729) * 2 - 1) * spec.amp * 0.12;
    const right = spec.side * spec.amp * k * Math.sin(ph) + spec.lean * Math.min(i, spec.start) + jitter;
    out.push([right, up]);
  }
  return out;
}

/**
 * Шанс разрыва головы при убийстве в голову. Слабые пистолеты — почти никогда,
 * крупный калибр и винтовки — заметно, снайперские — чаще всего. Нож и гранаты — 0
 * (граната рвёт тело целиком, см. разрыв тела на сервере).
 */
const HEAD_EXPLODE: Record<string, number> = {
  osa: 0.02, // Glock-17
  beretta: 0.05,
  python: 0.3,
  gyurza: 0.35, // Desert Eagle
  sw29: 0.4,
  skorpion: 0.08,
  mac10: 0.08,
  shmel: 0.1, // MP5
  ump: 0.12,
  molot: 0.5, // Remington 870
  sawedoff: 0.5,
  m4a1: 0.3,
  vikhr: 0.38, // АК-47
  aug: 0.35,
  sokol: 0.6, // Мосин-Наган
  awm: 0.65,
};

export const WEAPONS: WeaponDef[] = RAW_WEAPONS.map((w) => ({ ...w, headExplode: HEAD_EXPLODE[w.key] ?? 0, pattern: SPRAY[w.key] ? makePattern(SPRAY[w.key], w.mag, w.id) : [] }));

// индекс в массиве = id оружия (на это опираются клиент и протокол)
WEAPONS.sort((a, b) => a.id - b.id);

export const WEAPON_BY_KEY: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));
export const DEFAULT_PISTOL = WEAPONS[1];

/** Урон одной пули (дробины) до множителя части тела и брони на дистанции dist метров. */
export function damageAt(def: WeaponDef, dist: number): number {
  return def.damage * Math.pow(def.falloff, Math.max(0, dist) / 10);
}

/** Оружие-граната в руках для типа (0..3) и стороны: зажигательная у атаки — молотов. */
export function nadeWeapon(type: number, team: number): WeaponDef {
  if (type === 3) return WEAPON_BY_KEY[team === 0 ? 'molotov' : 'incgrenade'];
  return WEAPON_BY_KEY[NADE_TYPES[type]];
}

/** Продаётся ли предмет этой стороне. */
export function forTeam(def: WeaponDef, team: number): boolean {
  return def.team === undefined || def.team === team;
}
export const KNIFE = WEAPONS[0];

/** Раскраски оружия (косметика). */
export const SKINS = [
  { key: 'std', name: 'Стандарт', tint: 0xffffff },
  { key: 'desert', name: 'Пустыня', tint: 0xd9b77a },
  { key: 'night', name: 'Ночь', tint: 0x55607a },
  { key: 'forest', name: 'Лес', tint: 0x7f9a5e },
  { key: 'ember', name: 'Уголь', tint: 0xc46a42 },
];

/** Варианты агентов для каждой стороны. */
export const AGENTS: [string[], string[]] = [
  ['Пустынный стрелок', 'Горный стрелок'],
  ['Штурмовик', 'Городской оперативник'],
];

/**
 * Направление выстрела с разбросом. Разброс детерминирован по зерну,
 * поэтому клиент рисует тот же трассер, что посчитал сервер.
 */
export function shotDirection(
  yaw: number,
  pitch: number,
  spread: number,
  seed: number,
  pellet: number,
  out: [number, number, number],
  /** смещение паттерна очереди [вправо, вверх], рад */
  kick?: readonly [number, number],
): [number, number, number] {
  if (kick) {
    yaw -= kick[0]; // yaw растёт влево
    pitch = Math.max(-1.55, Math.min(1.55, pitch + kick[1]));
  }
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const fx = -sy * cp,
    fy = sp,
    fz = -cy * cp;
  const rx = cy,
    rz = -sy; // вправо
  // вверх = right × forward
  const ux = -rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy;
  const a = rand01(seed * 7 + pellet * 131 + 1) * Math.PI * 2;
  const r = Math.sqrt(rand01(seed * 13 + pellet * 977 + 7)) * spread;
  const ox = Math.cos(a) * r,
    oy = Math.sin(a) * r;
  let dx = fx + rx * ox + ux * oy;
  let dy = fy + uy * oy;
  let dz = fz + rz * ox + uz * oy;
  const l = Math.hypot(dx, dy, dz);
  dx /= l;
  dy /= l;
  dz /= l;
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
  return out;
}

export function viewDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// ---------- Серия выстрелов (паттерн отдачи) ----------
//
// Состояние серии — два целых: номер следующего выстрела и сколько команд прошло с последнего.
// Оно меняется только по командам ввода (по одной на тик 64 Гц), поэтому сервер и клиент,
// прогнав одни и те же команды, получают один и тот же номер выстрела, при любой задержке.
// Если они всё же разошлись (сервер выбросил команды из переполненной очереди, клиент
// ошибся в предсказании — например, магазин уже пуст), сервер присылает своё состояние
// в снапшоте вместе с номером последней применённой команды, а клиент переигрывает
// поверх него ещё не подтверждённые команды (как с движением).

/** Сколько команд без выстрела серия держится (больше интервала любого автомата: 0.1 с = 6.4 тика). */
export const SPRAY_HOLD = 8;
/** После паузы номер выстрела уменьшается на 1 каждые столько команд (полный спад 30 выстрелов ≈ 1 с). */
export const SPRAY_DECAY = 2;
export const SPRAY_MAX = 64;
/** Доля прежнего круга разброса от очереди, остающаяся у оружия с паттерном. */
export const SPRAY_CONE = 0.6;

export interface SprayState {
  /** номер следующего выстрела серии (0 — первый) */
  idx: number;
  /** команд с последнего выстрела (до 255) */
  idle: number;
  /**
   * сколько команд серия держится после выстрела — берётся у оружия при выстреле (sprayHold).
   * В снапшоте не передаётся: и сервер, и клиент ставят его сами при каждом выстреле.
   */
  hold: number;
}

export function newSpray(): SprayState {
  return { idx: 0, idle: 255, hold: SPRAY_HOLD };
}

/**
 * Удержание серии для оружия: у автоматов — SPRAY_HOLD; у полуавтоматов — интервал между
 * выстрелами плюс ~0.2 с, иначе серия спадала бы между нажатиями и частая стрельба из
 * пистолета не уводила бы прицел вверх (как в CS: «спам» неточен, редкие выстрелы точны).
 */
export function sprayHold(def: WeaponDef): number {
  return def.auto ? SPRAY_HOLD : Math.max(SPRAY_HOLD, Math.round(def.interval / DT) + 12);
}

/** Шаг серии на каждую команду — до проверки выстрела. Не зависит от оружия в руках. */
export function sprayTick(s: SprayState) {
  if (s.idle < 255) s.idle++;
  if (s.idx > 0 && s.idle > s.hold && (s.idle - s.hold) % SPRAY_DECAY === 0) s.idx--;
}

/** Выстрел: возвращает номер этого выстрела в серии и продвигает серию. */
export function sprayFire(s: SprayState, hold = s.hold): number {
  const i = s.idx;
  s.hold = hold;
  s.idx = Math.min(SPRAY_MAX, s.idx + 1);
  s.idle = 0;
  return i;
}

/**
 * Сверка с сервером: состояние серии после подтверждённой команды (из снапшота) плюс
 * переигранные поверх неё неподтверждённые команды; `fired` — где клиент предсказал выстрел.
 */
export function spraySync(s: SprayState, idx: number, idle: number, pendingSeqs: Iterable<number>, fired: Set<number>) {
  s.idx = idx;
  s.idle = idle;
  for (const q of pendingSeqs) {
    sprayTick(s);
    if (fired.has(q)) sprayFire(s);
  }
}

/** Смещение паттерна для выстрела с номером idx (за концом паттерна — последняя точка). */
export function sprayKick(def: WeaponDef, idx: number): readonly [number, number] {
  const p = def.pattern;
  if (!p.length) return ZERO_KICK;
  return p[Math.min(idx, p.length - 1)];
}
const ZERO_KICK: readonly [number, number] = [0, 0];

/** Добавка к кругу разброса от очереди (прежняя модель recoil/recoilMax; у паттерна — ослабленная). */
export function sprayCone(def: WeaponDef, idx: number): number {
  const c = Math.min(def.recoil * idx, def.recoilMax);
  return def.pattern.length ? c * SPRAY_CONE : c;
}

/** Множитель скорости бега: вес оружия, у снайперки в прицеле ещё ×0.6 (как в CS). */
export function moveSpeedMul(def: WeaponDef, buttons: number): number {
  return def.speed * (def.kind === 'sniper' && buttons & BTN_SCOPE ? 0.6 : 1);
}
