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
 * Анимация тела — только картинка в клиенте. Сервер её не передаёт и хитбоксы
 * считает по позе без анимации, поэтому на попадания она не влияет.
 * Углы в радианах; для ног и рук «+» — конец конечности вперёд.
 */
export interface PoseAnim {
  /** доля приседа 0..1 (плавный переход вместо мгновенного) */
  crouch: number;
  /** мах бедра левой и правой ноги */
  legL: number;
  legR: number;
  /** сгиб колен (голень назад); не входит в позу — его применяет VoxelBody */
  kneeL: number;
  kneeR: number;
  /** смещение всего тела выше бёдер по вертикали, м */
  bob: number;
  /** наклон торса вперёд («−» — вперёд, как у приседа) */
  lean: number;
  /** доворот оружия вверх/вниз (отдача, бег) */
  armPitch: number;
  /** перезарядка 0..1: левая рука уходит к магазину */
  reload: number;
  /** поворот головы относительно тела */
  headYaw: number;
  /** закладка/обезвреживание 0..1: на колене, руки у земли; useT — время для движения пальцев */
  use: number;
  useT: number;
  /** вид оружия в руках: от него зависит хват */
  weapon: string;
  /** цевьё конкретной модели относительно рукояти: вперёд вдоль ствола и вверх, м (0 — по виду оружия) */
  foreD: number;
  foreUp: number;
  // ---- выход computePose (заполняется им) ----
  /** сгиб локтей; применяет VoxelBody */
  elbowL: number;
  elbowR: number;
  /** положение оружия: точка хвата правой руки и поворот (формат как у части позы) */
  gun: Float32Array;
}

export function newPoseAnim(): PoseAnim {
  return { crouch: 0, legL: 0, legR: 0, kneeL: 0, kneeR: 0, bob: 0, lean: 0, armPitch: 0, reload: 0, headYaw: 0, use: 0, useT: 0, weapon: 'rifle', foreD: 0, foreUp: 0, elbowL: 0, elbowR: 0, gun: new Float32Array(POSE_STRIDE) };
}

/** Число вокселей предплечья и голени (ниже локтя и колена). */
export const ARM_SPLIT = 5;
export const LEG_SPLIT = 6;
const UPPER_ARM = (11 - ARM_SPLIT) * BVOX; // 0.36
const FOREARM = ARM_SPLIT * BVOX; // 0.30

/**
 * Хват оружия в системе тела: x — вправо, y — вверх от плеч, z — назад (перед — −z).
 * grip — правая кисть на рукояти, left — левая кисть, mag — куда левая рука тянется при перезарядке.
 * Точки задаются до наклона оружия по взгляду.
 */
interface Grip {
  grip: [number, number, number];
  left: [number, number, number];
  mag: [number, number, number];
  /** доля наклона взгляда, на которую поворачивается оружие */
  follow: number;
  /** левая рука не держит оружие (нож) */
  leftFree?: boolean;
}
/** fore — от рукояти до цевья вдоль ствола, up — насколько цевьё выше рукояти (по моделям оружия, м) */
const LONG = (fore: number, up: number, mag = 0.1): Grip => ({ grip: [0.1, -0.1, -0.2], left: [0.09, -0.1 + up - 0.02, -0.2 - fore], mag: [0.05, -0.27, -0.2 - mag], follow: 0.9 });
const GRIPS: Record<string, Grip> = {
  rifle: LONG(0.29, 0.07),
  smg: LONG(0.21, 0.08, 0.06),
  shotgun: LONG(0.34, 0.015, 0.2),
  sniper: LONG(0.34, 0.045),
  pistol: { grip: [0.05, -0.07, -0.47], left: [-0.005, -0.11, -0.44], mag: [-0.02, -0.26, -0.33], follow: 0.9 },
  knife: { grip: [0.2, -0.3, -0.27], left: [-0.17, -0.42, -0.14], mag: [-0.17, -0.42, -0.14], follow: 0.5, leftFree: true },
  grenade: { grip: [0.25, 0.03, -0.1], left: [-0.08, -0.15, -0.35], mag: [-0.08, -0.15, -0.35], follow: 0.6 },
};

/** Длина ноги (бедро + голень) и высота сустава колена от низа ноги. */
export const BODY_LEG_H = LEG_H;

/**
 * Поза живого игрока. (x,y,z) — точка между ступнями.
 * Руки вытянуты вперёд к оружию и следуют за наклоном взгляда.
 * Без anim — поза для хитбоксов (сервер); с anim — живая поза для отрисовки.
 */
export function computePose(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  crouch: boolean,
  out: Float32Array,
  anim?: PoseAnim,
): Float32Array {
  if (anim) return computeAnimatedPose(x, y, z, yaw, pitch, anim, out);
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

/** Живая поза: ноги поворачиваются в бедре (не сплющиваются), торс наклоняется от бёдер. */
function computeAnimatedPose(x: number, y: number, z: number, yaw: number, pitch: number, an: PoseAnim, out: Float32Array): Float32Array {
  const cyw = Math.cos(yaw),
    syw = Math.sin(yaw);
  const lx = (ax: number, az: number) => x + cyw * ax + syw * az;
  const lz = (ax: number, az: number) => z - syw * ax + cyw * az;
  const c = an.crouch;
  // высота бёдер та же, что у хитбоксов: при полном приседе ниже на CROUCH_DROP
  const hipY = y + LEG_H - CROUCH_DROP * c + an.bob;
  const half = LEG_H / 2;
  for (const [part, side, swing] of [
    [PART_LEG_L, -1, an.legL],
    [PART_LEG_R, 1, an.legR],
  ] as const) {
    // центр ноги = бедро + Rx(swing)·(0, −h/2, 0)
    const ax = side * 0.12,
      az = -Math.sin(swing) * half;
    writePart(out, part, lx(ax, az), hipY - Math.cos(swing) * half, lz(ax, az), yaw, swing, 1);
  }
  const tp = -0.15 * c + an.lean;
  // торс поворачивается вокруг бёдер
  const tzc = Math.sin(tp) * (TORSO_H / 2);
  writePart(out, PART_TORSO, lx(0, tzc), hipY + Math.cos(tp) * (TORSO_H / 2), lz(0, tzc), yaw, tp, 1);
  // верх торса: туда же переезжают голова и плечи
  const topZ = Math.sin(tp) * TORSO_H,
    topY = hipY + Math.cos(tp) * TORSO_H;
  const hz = topZ + Math.sin(tp) * (HEAD_H / 2);
  writePart(out, PART_HEAD, lx(0, hz), topY + HEAD_H / 2, lz(0, hz), yaw + an.headYaw, pitch * 0.5, 1);
  const shY = topY - 0.05;

  // ---- оружие: поворачивается вокруг линии плеч вслед за взглядом ----
  const g = GRIPS[an.weapon] ?? GRIPS.rifle;
  const gp = pitch * g.follow + an.armPitch;
  const cg = Math.cos(gp),
    sg = Math.sin(gp);
  // точка хвата (локально, от середины плеч) → после наклона Rx(gp)
  const rot = (p: readonly [number, number, number], k = 1): [number, number, number] => {
    const c = k === 1 ? cg : Math.cos(gp * k),
      s = k === 1 ? sg : Math.sin(gp * k);
    return [p[0], shY + p[1] * c - p[2] * s, topZ + p[1] * s + p[2] * c];
  };
  const grip = rot(g.grip);
  writePart(an.gun, 0, lx(grip[0], grip[2]), grip[1], lz(grip[0], grip[2]), yaw, gp, 1);
  // левая кисть: на цевье / рукояти, при перезарядке — к магазину
  // у длинного оружия левая кисть — на цевье конкретной модели, если оно известно
  const left0: readonly [number, number, number] = an.foreD > 0 && !g.leftFree && g.follow > 0.8 && an.weapon !== 'pistol' ? [g.grip[0] - 0.01, g.grip[1] + an.foreUp - 0.02, g.grip[2] - an.foreD] : g.left;
  const lHold = g.leftFree ? ([g.left[0], shY + g.left[1], topZ + g.left[2]] as [number, number, number]) : rot(left0);
  const lMag = rot(g.mag, 0.5);
  const r = an.reload;
  const left: [number, number, number] = [lHold[0] + (lMag[0] - lHold[0]) * r, lHold[1] + (lMag[1] - lHold[1]) * r, lHold[2] + (lMag[2] - lHold[2]) * r];
  // закладка/обезвреживание: обе кисти у бомбы на земле перед коленями, пальцы по очереди «нажимают»
  const u = an.use;
  if (u > 0) {
    const tap = Math.sin(an.useT * 13);
    const handY = y + 0.2;
    const tR: [number, number, number] = [0.1, handY + 0.04 * Math.max(0, tap), -0.5];
    const tL: [number, number, number] = [-0.1, handY + 0.04 * Math.max(0, -tap), -0.46];
    for (let i = 0; i < 3; i++) {
      grip[i] += (tR[i] - grip[i]) * u;
      left[i] += (tL[i] - left[i]) * u;
    }
    // бомба в руках — горизонтально, у правой кисти
    writePart(an.gun, 0, lx(grip[0], grip[2]), grip[1], lz(grip[0], grip[2]), yaw, gp * (1 - u), 1);
  }

  // ---- руки: плечо → локоть → кисть ----
  const sz = topZ - 0.02;
  an.elbowR = solveArm(out, PART_ARM_R, [SHOULDER_X, shY, sz], grip, [0.55, -1, 0.35], cyw, syw, x, z);
  an.elbowL = solveArm(out, PART_ARM_L, [-SHOULDER_X, shY, sz], left, [-0.55, -1, 0.35], cyw, syw, x, z);
  return out;
}

/**
 * Рука из двух звеньев (плечо 0.36 м, предплечье 0.30 м) тянется к точке hand.
 * Все точки — в системе тела (x вправо, −z вперёд). Локоть уходит в сторону pole.
 * Пишет верхнее звено как всю часть (сгиб предплечья делает VoxelBody), возвращает угол локтя.
 */
function solveArm(
  out: Float32Array,
  part: number,
  s: readonly [number, number, number],
  hand: readonly [number, number, number],
  pole: readonly [number, number, number],
  cyw: number,
  syw: number,
  x: number,
  z: number,
): number {
  let dx = hand[0] - s[0],
    dy = hand[1] - s[1],
    dz = hand[2] - s[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1;
  }
  const ux0 = dx / d,
    uy0 = dy / d,
    uz0 = dz / d;
  const reach = Math.min(UPPER_ARM + FOREARM - 1e-4, Math.max(Math.abs(UPPER_ARM - FOREARM) + 0.02, d));
  // угол в плече между направлением на кисть и плечевой костью
  const cosA = (UPPER_ARM * UPPER_ARM + reach * reach - FOREARM * FOREARM) / (2 * UPPER_ARM * reach);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // направление сгиба: проекция pole на плоскость, перпендикулярную линии плечо–кисть
  const pd = pole[0] * ux0 + pole[1] * uy0 + pole[2] * uz0;
  let px = pole[0] - ux0 * pd,
    py = pole[1] - uy0 * pd,
    pz = pole[2] - uz0 * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  // плечевая кость
  const ca = Math.cos(A),
    sa = Math.sin(A);
  const ux = ux0 * ca + px * sa,
    uy = uy0 * ca + py * sa,
    uz = uz0 * ca + pz * sa;
  // предплечье: от локтя к (досягаемой) кисти
  const ex = s[0] + ux * UPPER_ARM,
    ey = s[1] + uy * UPPER_ARM,
    ez = s[2] + uz * UPPER_ARM;
  let fx = s[0] + ux0 * reach - ex,
    fy = s[1] + uy0 * reach - ey,
    fz = s[2] + uz0 * reach - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  const fu = fx * ux + fy * uy + fz * uz;
  const bend = Math.acos(Math.max(-1, Math.min(1, fu)));
  // оси части: Y — к плечу (−u), Z — против сгиба, X = Y × Z
  const Yx = -ux,
    Yy = -uy,
    Yz = -uz;
  let Zx = -(fx - ux * fu),
    Zy = -(fy - uy * fu),
    Zz = -(fz - uz * fu);
  let zl = Math.hypot(Zx, Zy, Zz);
  if (zl < 1e-4) {
    // рука прямая: плоскость сгиба задаёт pole
    Zx = -px;
    Zy = -py;
    Zz = -pz;
    zl = 1;
  }
  Zx /= zl;
  Zy /= zl;
  Zz /= zl;
  const Xx = Yy * Zz - Yz * Zy,
    Xy = Yz * Zx - Yx * Zz,
    Xz = Yx * Zy - Yy * Zx;
  // из системы тела в мир: поворот на yaw вокруг Y
  const wx = (vx: number, vz: number) => cyw * vx + syw * vz;
  const wz = (vx: number, vz: number) => -syw * vx + cyw * vz;
  const half = ARM_L / 2;
  const cx = s[0] + ux * half,
    cy = s[1] + uy * half,
    cz = s[2] + uz * half;
  const o = part * POSE_STRIDE;
  out[o] = x + wx(cx, cz);
  out[o + 1] = cy;
  out[o + 2] = z + wz(cx, cz);
  // строки матрицы: столбцы — оси X, Y, Z в мире
  out[o + 3] = wx(Xx, Xz);
  out[o + 4] = wx(Yx, Yz);
  out[o + 5] = wx(Zx, Zz);
  out[o + 6] = Xy;
  out[o + 7] = Yy;
  out[o + 8] = Zy;
  out[o + 9] = wz(Xx, Xz);
  out[o + 10] = wz(Yx, Yz);
  out[o + 11] = wz(Zx, Zz);
  out[o + 12] = 1;
  return bend;
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
