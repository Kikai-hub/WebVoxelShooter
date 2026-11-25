// Оружие: характеристики общие для сервера, клиента и меню снаряжения.

import { rand01 } from './rng';

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
  /** продаётся только этой стороне (0 — атака, 1 — защита) */
  team?: 0 | 1;
}

// Ключи (osa, vikhr…) — внутренние и хранятся в снаряжении игроков: не менять. Названия — реальные.
export const WEAPONS: WeaponDef[] = [
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
): [number, number, number] {
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
