// Косметические сколы: блок 0,5 м делится на 4×4×4 под-вокселя по 12,5 см.
// Скол убирает под-воксели в небольшом шаре у точки попадания, не глубже 2 слоёв от грани.
// Коллизия, прострел и линии обзора НЕ меняются — это только картинка.

import { MAT, VOXEL, VoxelMap } from './map';

export const SUB = 4;
export const SUB_SIZE = VOXEL / SUB;
export const MAX_CHIPS_PER_ROUND = 2000;
export const MAX_CHIPS_PER_BLOCK = 30;
export const MAX_CHIP_DEPTH = 2;

/** Операция скола: блок, под-клетка точки попадания, радиус (в под-вокселях ×2), нормаль грани. */
export interface ChipOp {
  bx: number;
  by: number;
  bz: number;
  sx: number;
  sy: number;
  sz: number;
  r2: number;
  nx: number;
  ny: number;
  nz: number;
}

/** Можно ли колоть этот материал (пол, вода и листва — нет). */
export function chippable(map: VoxelMap, bx: number, by: number, bz: number, allowFloor = false): boolean {
  if (by < 0 || (by === 0 && !allowFloor)) return false;
  const m = map.get(bx, by, bz);
  return m !== 0 && m !== MAT.WATER && m !== MAT.LEAVES;
}

/** Сделать операцию из точки попадания на грани блока. */
export function makeChip(bx: number, by: number, bz: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, radius: number): ChipOp {
  const c = (v: number, b: number) => Math.max(0, Math.min(SUB - 1, Math.floor((v - b * VOXEL) / SUB_SIZE)));
  // точку чуть внутрь блока, чтобы попасть в его под-клетку
  const e = SUB_SIZE * 0.3;
  return { bx, by, bz, sx: c(px - nx * e, bx), sy: c(py - ny * e, by), sz: c(pz - nz * e, bz), r2: Math.round(radius * 2), nx, ny, nz };
}

/**
 * Применить скол к маске блока (64 бита в Uint8Array: 1 — под-воксель выбит).
 * Детерминированно: одна и та же операция даёт одинаковую картинку у всех.
 */
export function applyChip(mask: Uint8Array, op: ChipOp): number {
  const r = op.r2 / 2;
  const cx = op.sx + 0.5,
    cy = op.sy + 0.5,
    cz = op.sz + 0.5;
  let removed = 0;
  for (let z = 0; z < SUB; z++)
    for (let y = 0; y < SUB; y++)
      for (let x = 0; x < SUB; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
        if (d > r + 0.01) continue;
        // глубина от грани попадания (грань со стороны нормали)
        const depth = op.nx > 0 ? SUB - 1 - x : op.nx < 0 ? x : op.ny > 0 ? SUB - 1 - y : op.ny < 0 ? y : op.nz > 0 ? SUB - 1 - z : z;
        if (depth >= MAX_CHIP_DEPTH) continue;
        const i = x + SUB * (y + SUB * z);
        if (!mask[i]) {
          mask[i] = 1;
          removed++;
        }
      }
  return removed;
}

export function blockKey(bx: number, by: number, bz: number): number {
  return bx + 1024 * (bz + 1024 * by);
}

export function chipToArray(op: ChipOp): number[] {
  return [op.bx, op.by, op.bz, op.sx, op.sy, op.sz, op.r2, op.nx, op.ny, op.nz];
}

export function chipFromArray(a: number[], o = 0): ChipOp {
  return { bx: a[o], by: a[o + 1], bz: a[o + 2], sx: a[o + 3], sy: a[o + 4], sz: a[o + 5], r2: a[o + 6], nx: a[o + 7], ny: a[o + 8], nz: a[o + 9] };
}
