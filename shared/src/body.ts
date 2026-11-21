// Воксельное тело: 6 частей из вокселей по 6 см. Хитбоксы = те же части.
// Поза: на каждую часть центр (3), матрица поворота 3×3 по строкам (9), масштаб по Y (1).

export const BVOX = 0.06;
export const PART_HEAD = 0;
export const PART_TORSO = 1;
export const PART_ARM_L = 2;
export const PART_ARM_R = 3;
export const PART_LEG_L = 4;
export const PART_LEG_R = 5;
export const PART_COUNT = 6;
export const PART_NAMES = ['голова', 'торс', 'левая рука', 'правая рука', 'левая нога', 'правая нога'];

/** Размер частей в вокселях: x (ширина), y (высота), z (глубина). Перед тела — -Z. */
export const PART_DIMS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 6, 6],
  [8, 11, 5],
  [3, 11, 3],
  [3, 11, 3],
  [4, 13, 4],
  [4, 13, 4],
];
export const PART_DAMAGE = [4, 1, 0.8, 0.8, 0.7, 0.7];

export const POSE_STRIDE = 13;
export const POSE_SIZE = POSE_STRIDE * PART_COUNT;

const LEG_H = 13 * BVOX; // 0.78
const TORSO_H = 11 * BVOX; // 0.66
const HEAD_H = 6 * BVOX; // 0.36
const ARM_L = 11 * BVOX;
const SHOULDER_X = (8 * BVOX) / 2 + (3 * BVOX) / 2; // 0.33
const CROUCH_DROP = 0.5;

function writePart(
  out: Float32Array,
  p: number,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  pitch: number,
  sy: number,
) {
  // R = Ry(yaw) * Rx(pitch)
  const cyw = Math.cos(yaw),
    syw = Math.sin(yaw);
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const o = p * POSE_STRIDE;
  out[o] = cx;
  out[o + 1] = cy;
  out[o + 2] = cz;
  // строки матрицы
  out[o + 3] = cyw;
  out[o + 4] = syw * sp;
  out[o + 5] = syw * cp;
  out[o + 6] = 0;
  out[o + 7] = cp;
  out[o + 8] = -sp;
  out[o + 9] = -syw;
  out[o + 10] = cyw * sp;
  out[o + 11] = cyw * cp;
  out[o + 12] = sy;
}

/**
 * Поза живого игрока. (x,y,z) — точка между ступнями.
 * Руки вытянуты вперёд к оружию и следуют за наклоном взгляда.
 */
export function computePose(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  crouch: boolean,
  out: Float32Array,
): Float32Array {
  const cyw = Math.cos(yaw),
    syw = Math.sin(yaw);
  // локальная точка -> мир (только поворот по yaw)
  const lx = (ax: number, az: number) => x + cyw * ax + syw * az;
  const lz = (ax: number, az: number) => z - syw * ax + cyw * az;
  const drop = crouch ? CROUCH_DROP : 0;
  const legH = LEG_H - drop;
  const legS = legH / LEG_H;
  writePart(out, PART_LEG_L, lx(-0.12, crouch ? -0.08 : 0), y + legH / 2, lz(-0.12, crouch ? -0.08 : 0), yaw, 0, legS);
  writePart(out, PART_LEG_R, lx(0.12, crouch ? 0.06 : 0), y + legH / 2, lz(0.12, crouch ? 0.06 : 0), yaw, 0, legS);
  const torsoY = y + legH + TORSO_H / 2;
  writePart(out, PART_TORSO, x, torsoY, z, yaw, crouch ? -0.15 : 0, 1);
  writePart(out, PART_HEAD, lx(0, crouch ? -0.05 : 0), y + legH + TORSO_H + HEAD_H / 2, lz(0, crouch ? -0.05 : 0), yaw, pitch * 0.5, 1);
  const shY = y + legH + TORSO_H - 0.05;
  const a = 1.25 + pitch * 0.85;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  // направление руки в локальных координатах: (0, -cos a, -sin a)
  const half = ARM_L / 2;
  for (const [part, side, inward] of [
    [PART_ARM_L, -1, 0.1],
    [PART_ARM_R, 1, 0],
  ] as const) {
    const ax = side * SHOULDER_X,
      az = -0.02;
    const cxl = ax - side * inward * half; // левая рука чуть внутрь, к цевью
    const cyl = -ca * half;
    const czl = az - sa * half;
    writePart(out, part, lx(cxl, czl), shY + cyl, lz(cxl, czl), yaw, a, 1);
  }
  return out;
}

export interface BodyHit {
  t: number;
  part: number;
  /** Воксель входа */
  ix: number;
  iy: number;
  iz: number;
  /** Воксель выхода (дальняя сторона части) */
  ex: number;
  ey: number;
  ez: number;
  tExit: number;
}

export function newBodyHit(): BodyHit {
  return { t: 0, part: 0, ix: 0, iy: 0, iz: 0, ex: 0, ey: 0, ez: 0, tExit: 0 };
}

function clampi(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

/** Луч против всех частей тела в позе. */
export function raycastBody(
  pose: Float32Array,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: BodyHit,
): boolean {
  let best = maxT;
  let found = false;
  for (let p = 0; p < PART_COUNT; p++) {
    const o = p * POSE_STRIDE;
    const rx = ox - pose[o],
      ry = oy - pose[o + 1],
      rz = oz - pose[o + 2];
    // локально = R^T * v, R по строкам: столбец i = (R[0][i], R[1][i], R[2][i])
    const m = pose;
    const lox = m[o + 3] * rx + m[o + 6] * ry + m[o + 9] * rz;
    const loy = m[o + 4] * rx + m[o + 7] * ry + m[o + 10] * rz;
    const loz = m[o + 5] * rx + m[o + 8] * ry + m[o + 11] * rz;
    const ldx = m[o + 3] * dx + m[o + 6] * dy + m[o + 9] * dz;
    const ldy = m[o + 4] * dx + m[o + 7] * dy + m[o + 10] * dz;
    const ldz = m[o + 5] * dx + m[o + 8] * dy + m[o + 11] * dz;
    const [nx, ny, nz] = PART_DIMS[p];
    const sy = m[o + 12];
    const hx = (nx * BVOX) / 2,
      hy = (ny * BVOX * sy) / 2,
      hz = (nz * BVOX) / 2;
    let tmin = -Infinity,
      tmax = Infinity;
    const slab = (lo: number, ld: number, h: number): boolean => {
      if (Math.abs(ld) < 1e-9) return lo >= -h && lo <= h;
      let t1 = (-h - lo) / ld,
        t2 = (h - lo) / ld;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!slab(lox, ldx, hx) || !slab(loy, ldy, hy) || !slab(loz, ldz, hz)) continue;
    if (tmax < 0) continue;
    const t = Math.max(tmin, 0);
    if (t >= best) continue;
    best = t;
    found = true;
    out.t = t;
    out.part = p;
    out.tExit = tmax;
    const vy = BVOX * sy;
    out.ix = clampi(Math.floor((lox + ldx * t + hx) / BVOX), nx);
    out.iy = clampi(Math.floor((loy + ldy * t + hy) / vy), ny);
    out.iz = clampi(Math.floor((loz + ldz * t + hz) / BVOX), nz);
    out.ex = clampi(Math.floor((lox + ldx * tmax + hx) / BVOX), nx);
    out.ey = clampi(Math.floor((loy + ldy * tmax + hy) / vy), ny);
    out.ez = clampi(Math.floor((loz + ldz * tmax + hz) / BVOX), nz);
  }
  return found;
}

/** Операция раны: часть, воксель, радиус, выходное ли отверстие. 8 байт в бинарном виде. */
export interface WoundOp {
  p: number;
  x: number;
  y: number;
  z: number;
  r: number;
  exit: 0 | 1;
}
