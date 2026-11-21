// Луч по воксельной сетке карты (алгоритм Amanatides–Woo).

import { VOXEL, VoxelMap } from './map';

export interface MapHit {
  t: number;
  vx: number;
  vy: number;
  vz: number;
  nx: number;
  ny: number;
  nz: number;
  mat: number;
}

export function newMapHit(): MapHit {
  return { t: 0, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0, mat: 0 };
}

/** Направление (dx,dy,dz) должно быть нормализовано. Возвращает true при попадании ближе maxT. */
export function raycastMap(
  map: VoxelMap,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: MapHit,
): boolean {
  const px = ox / VOXEL,
    py = oy / VOXEL,
    pz = oz / VOXEL;
  let x = Math.floor(px),
    y = Math.floor(py),
    z = Math.floor(pz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = stepX !== 0 ? Math.abs(VOXEL / dx) : Infinity;
  const tdy = stepY !== 0 ? Math.abs(VOXEL / dy) : Infinity;
  const tdz = stepZ !== 0 ? Math.abs(VOXEL / dz) : Infinity;
  let tmx = stepX > 0 ? (x + 1 - px) * tdx : stepX < 0 ? (px - x) * tdx : Infinity;
  let tmy = stepY > 0 ? (y + 1 - py) * tdy : stepY < 0 ? (py - y) * tdy : Infinity;
  let tmz = stepZ > 0 ? (z + 1 - pz) * tdz : stepZ < 0 ? (pz - z) * tdz : Infinity;
  let t = 0;
  let nx = 0,
    ny = 0,
    nz = 0;
  // Если старт внутри блока — считаем попаданием на нулевой дистанции
  const m0 = map.get(x, y, z);
  if (m0 !== 0) {
    out.t = 0;
    out.vx = x;
    out.vy = y;
    out.vz = z;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.mat = m0;
    return true;
  }
  for (let i = 0; i < 1024; i++) {
    if (tmx < tmy && tmx < tmz) {
      x += stepX;
      t = tmx;
      tmx += tdx;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tmy < tmz) {
      y += stepY;
      t = tmy;
      tmy += tdy;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tmz;
      tmz += tdz;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxT) return false;
    if (y >= map.sy && stepY >= 0) return false;
    const m = map.get(x, y, z);
    if (m !== 0) {
      out.t = t;
      out.vx = x;
      out.vy = y;
      out.vz = z;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.mat = m;
      return true;
    }
  }
  return false;
}

const tmpHit = newMapHit();

/** Есть ли прямая видимость между двумя точками. */
export function lineOfSight(map: VoxelMap, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return !raycastMap(map, ax, ay, az, dx / len, dy / len, dz / len, len, tmpHit);
}
