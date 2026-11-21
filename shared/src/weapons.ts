// Оружие: характеристики общие для сервера, клиента и меню снаряжения.

import { rand01 } from './rng';

export const SLOT_PRIMARY = 0;
export const SLOT_PISTOL = 1;
export const SLOT_KNIFE = 2;
/** Слоты гранат: 3 — осколочная, 4 — светошумовая, 5 — дымовая */
export const SLOT_HE = 3;
export const SLOT_FLASH = 4;
export const SLOT_SMOKE = 5;
export const SLOT_NAMES = ['Основное', 'Пистолет', 'Нож', 'Осколочная', 'Светошумовая', 'Дымовая'];
export const NADE_TYPES = ['he', 'flash', 'smoke'] as const;
export type NadeType = (typeof NADE_TYPES)[number];
/** сколько гранат каждого типа можно нести */
export const NADE_LIMIT: Record<NadeType, number> = { he: 1, flash: 2, smoke: 1 };

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
}

export const WEAPONS: WeaponDef[] = [
  { id: 0, key: 'knife', name: 'Нож', kind: 'knife', slot: SLOT_KNIFE, price: 0, damage: 45, interval: 0.55, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 1.9, armorPen: 0.85, auto: true, pellets: 1, killReward: 1500, speed: 1.05 },
  { id: 1, key: 'osa', name: 'Оса', kind: 'pistol', slot: SLOT_PISTOL, price: 0, damage: 28, interval: 0.15, mag: 20, reserve: 100, reload: 2.2, spread: 0.006, moveSpread: 0.03, recoil: 0.012, recoilMax: 0.05, range: 200, armorPen: 0.5, auto: false, pellets: 1, killReward: 300, speed: 1 },
  { id: 2, key: 'gyurza', name: 'Гюрза', kind: 'pistol', slot: SLOT_PISTOL, price: 700, damage: 55, interval: 0.26, mag: 7, reserve: 35, reload: 2.2, spread: 0.005, moveSpread: 0.05, recoil: 0.03, recoilMax: 0.08, range: 200, armorPen: 0.9, auto: false, pellets: 1, killReward: 300, speed: 0.98 },
  { id: 3, key: 'shmel', name: 'Шмель', kind: 'smg', slot: SLOT_PRIMARY, price: 1250, damage: 26, interval: 0.075, mag: 30, reserve: 120, reload: 2.4, spread: 0.01, moveSpread: 0.02, recoil: 0.006, recoilMax: 0.06, range: 200, armorPen: 0.6, auto: true, pellets: 1, killReward: 600, speed: 0.97 },
  { id: 4, key: 'molot', name: 'Молот', kind: 'shotgun', slot: SLOT_PRIMARY, price: 1100, damage: 22, interval: 0.9, mag: 7, reserve: 32, reload: 3.0, spread: 0.065, moveSpread: 0.02, recoil: 0.02, recoilMax: 0.04, range: 40, armorPen: 0.5, auto: false, pellets: 8, killReward: 900, speed: 0.94 },
  { id: 5, key: 'vikhr', name: 'Вихрь', kind: 'rifle', slot: SLOT_PRIMARY, price: 2700, damage: 35, interval: 0.1, mag: 30, reserve: 90, reload: 2.5, spread: 0.003, moveSpread: 0.08, recoil: 0.008, recoilMax: 0.07, range: 300, armorPen: 0.78, auto: true, pellets: 1, killReward: 300, speed: 0.9 },
  { id: 7, key: 'he', name: 'Осколочная', kind: 'grenade', slot: SLOT_HE, price: 300, damage: 98, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0.57, auto: false, pellets: 1, killReward: 300, speed: 1 },
  { id: 8, key: 'flash', name: 'Светошумовая', kind: 'grenade', slot: SLOT_FLASH, price: 200, damage: 0, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0, auto: false, pellets: 1, killReward: 0, speed: 1 },
  { id: 9, key: 'smoke', name: 'Дымовая', kind: 'grenade', slot: SLOT_SMOKE, price: 300, damage: 0, interval: 0.8, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoil: 0, recoilMax: 0, range: 0, armorPen: 0, auto: false, pellets: 1, killReward: 0, speed: 1 },
  { id: 6, key: 'sokol', name: 'Сокол', kind: 'sniper', slot: SLOT_PRIMARY, price: 4750, damage: 115, interval: 1.4, mag: 5, reserve: 30, reload: 3.6, spread: 0.0008, moveSpread: 0.15, recoil: 0.05, recoilMax: 0.05, range: 500, armorPen: 0.97, auto: false, pellets: 1, killReward: 100, speed: 0.84 },
];

// индекс в массиве = id оружия (на это опираются клиент и протокол)
WEAPONS.sort((a, b) => a.id - b.id);

export const WEAPON_BY_KEY: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));
export const DEFAULT_PISTOL = WEAPONS[1];
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
