// Полёт гранаты: одна функция для сервера (авторитет) и клиента (отрисовка).
// Отскоки от вокселей с потерей скорости, качение по полу с трением.

import { DT, NADE_BOUNCE_MIN, NADE_GRAVITY, NADE_THROW_SPEED, SMOKE_RADIUS } from './constants';
import { VOXEL, VoxelMap } from './map';

export interface NadeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  resting: boolean;
}

const R = 0.06; // радиус гранаты

function solid(map: VoxelMap, x: number, y: number, z: number): boolean {
  return map.get(Math.floor(x / VOXEL), Math.floor(y / VOXEL), Math.floor(z / VOXEL)) !== 0;
}

/** Сила броска как в CS: ЛКМ — 1.0 (далеко), ЛКМ+ПКМ — 0.5, ПКМ — 0.3 (под ноги). */
export const THROW_STRONG = 1;
export const THROW_MEDIUM = 0.5;
export const THROW_SOFT = 0.3;

/** Доля скорости игрока, добавляемая к скорости гранаты (бросок «с разбега», в прыжке — выше). */
const INHERIT = 1;

/**
 * Начальное состояние броска из глаз игрока по направлению взгляда (с подбросом вверх).
 * strength 0..1: скорость = NADE_THROW_SPEED × (0.3 + 0.7 × strength); pvx/pvy/pvz — скорость игрока.
 */
export function throwNade(ex: number, ey: number, ez: number, yaw: number, pitch: number, pvx: number, pvz: number, strength = THROW_STRONG, pvy = 0): NadeState {
  const speed = NADE_THROW_SPEED * (0.3 + 0.7 * Math.max(0, Math.min(1, strength)));
  const p = Math.min(1.4, pitch + 0.12); // бросок чуть выше прицела
  const cp = Math.cos(p);
  const dx = -Math.sin(yaw) * cp,
    dy = Math.sin(p),
    dz = -Math.cos(yaw) * cp;
  return {
    x: ex + dx * 0.3,
    y: ey - 0.1,
    z: ez + dz * 0.3,
    vx: dx * speed + pvx * INHERIT,
    vy: dy * speed + pvy * INHERIT,
    vz: dz * speed + pvz * INHERIT,
    resting: false,
  };
}

/**
 * Один тик полёта (1/64 с). Возвращает скорость удара о поверхность, м/с, если она выше порога
 * отскока (NADE_BOUNCE_MIN), иначе 0: по этому значению клиент играет звук отскока.
 */
export function stepNade(n: NadeState, map: VoxelMap): number {
  if (n.resting) return 0;
  let hit = 0;
  n.vy -= NADE_GRAVITY * DT;
  // по осям: при столкновении — отражение с потерей энергии
  const nx = n.x + n.vx * DT;
  if (solid(map, nx + Math.sign(n.vx) * R, n.y, n.z)) {
    hit = Math.max(hit, Math.abs(n.vx));
    n.vx *= -0.45;
    n.vz *= 0.8;
  } else n.x = nx;
  const nz = n.z + n.vz * DT;
  if (solid(map, n.x, n.y, nz + Math.sign(n.vz) * R)) {
    hit = Math.max(hit, Math.abs(n.vz));
    n.vz *= -0.45;
    n.vx *= 0.8;
  } else n.z = nz;
  const ny = n.y + n.vy * DT;
  if (solid(map, n.x, ny + Math.sign(n.vy) * R, n.z)) {
    hit = Math.max(hit, Math.abs(n.vy));
    if (n.vy < 0) {
      n.y = (Math.floor((ny - R) / VOXEL) + 1) * VOXEL + R;
      n.vy = Math.abs(n.vy) > 1.5 ? -n.vy * 0.4 : 0;
      n.vx *= 0.7;
      n.vz *= 0.7;
    } else n.vy *= -0.3;
  } else n.y = ny;
  if (n.vy === 0 && Math.hypot(n.vx, n.vz) < 0.25) {
    n.vx = n.vz = 0;
    n.resting = true;
  }
  return hit >= NADE_BOUNCE_MIN ? hit : 0;
}

/** Пересекает ли отрезок a→b сферу дыма (с небольшим запасом по краю). */
export function segmentHitsSphere(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, r: number): boolean {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx,
    py = ay + dy * t - cy,
    pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

export interface Smoke {
  x: number;
  y: number;
  z: number;
  start: number;
  end: number;
}

/** Закрывает ли дым линию видимости (дым набирает плотность за 0,6 с). */
export function smokeBlocks(smokes: readonly Smoke[], now: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (const s of smokes) {
    if (now < s.start + 0.6 || now > s.end - 0.5) continue;
    if (segmentHitsSphere(ax, ay, az, bx, by, bz, s.x, s.y + 1, s.z, SMOKE_RADIUS * 0.9)) return true;
  }
  return false;
}
