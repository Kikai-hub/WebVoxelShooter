// Лёгкий рэгдолл на верле-точках (только клиент, косметика).
// Первые 0,1–0,5 с тело держит позу («мышцы»), потом обмякает.
// После успокоения замирает и лежит до конца раунда.

import {
  BVOX,
  PART_ARM_L,
  PART_ARM_R,
  PART_COUNT,
  PART_DIMS,
  PART_HEAD,
  PART_LEG_L,
  PART_LEG_R,
  PART_TORSO,
  POSE_STRIDE,
  VOXEL,
  VoxelMap,
} from '../../../shared/src/index';

// Точки: 0 макушка, 1 шея, 2 таз, 3 плечо Л, 4 плечо П, 5 кисть Л, 6 кисть П, 7 бедро Л, 8 бедро П, 9 стопа Л, 10 стопа П
const NP = 11;

interface Stick {
  a: number;
  b: number;
  len: number;
  temp: boolean;
}

function partEnds(pose: Float32Array, p: number): [number[], number[]] {
  const o = p * POSE_STRIDE;
  const hy = (PART_DIMS[p][1] * BVOX * pose[o + 12]) / 2;
  // ось Y части — второй столбец матрицы
  const ux = pose[o + 4],
    uy = pose[o + 7],
    uz = pose[o + 10];
  return [
    [pose[o] + ux * hy, pose[o + 1] + uy * hy, pose[o + 2] + uz * hy],
    [pose[o] - ux * hy, pose[o + 1] - uy * hy, pose[o + 2] - uz * hy],
  ];
}

export class Ragdoll {
  private x = new Float32Array(NP * 3);
  private px = new Float32Array(NP * 3);
  private sticks: Stick[] = [];
  private age = 0;
  private holdTime: number;
  private restTime = 0;
  sleeping = false;
  private rightX = 1;
  private rightZ = 0;

  constructor(
    private map: VoxelMap,
    pose: Float32Array,
    impulse: [number, number, number],
    hitPart: number,
    headshot: boolean,
  ) {
    const [headTop] = partEnds(pose, PART_HEAD);
    const [neck, pelvis] = partEnds(pose, PART_TORSO);
    const [shL, handL] = partEnds(pose, PART_ARM_L);
    const [shR, handR] = partEnds(pose, PART_ARM_R);
    const [hipL, footL] = partEnds(pose, PART_LEG_L);
    const [hipR, footR] = partEnds(pose, PART_LEG_R);
    const pts = [headTop, neck, pelvis, shL, shR, handL, handR, hipL, hipR, footL, footR];
    for (let i = 0; i < NP; i++) for (let k = 0; k < 3; k++) this.x[i * 3 + k] = pts[i][k];
    // правый вектор тела (для ориентации частей)
    const o = PART_TORSO * POSE_STRIDE;
    this.rightX = pose[o + 3];
    this.rightZ = pose[o + 9];
    // начальная скорость: толчок от пули сильнее у задетой части
    const dt = 1 / 60;
    const near: Record<number, number[]> = { [PART_HEAD]: [0, 1], [PART_TORSO]: [1, 2, 3, 4], [PART_ARM_L]: [3, 5], [PART_ARM_R]: [4, 6], [PART_LEG_L]: [7, 9], [PART_LEG_R]: [8, 10] };
    const strong = new Set(near[hitPart] ?? [1, 2]);
    for (let i = 0; i < NP; i++) {
      const k = strong.has(i) ? 3.2 : 1.2;
      this.px[i * 3] = this.x[i * 3] - impulse[0] * k * dt;
      this.px[i * 3 + 1] = this.x[i * 3 + 1] - Math.max(0, impulse[1]) * k * dt;
      this.px[i * 3 + 2] = this.x[i * 3 + 2] - impulse[2] * k * dt;
    }
    // подкошенные колени: стопы чуть вперёд, верх назад
    for (const i of [9, 10]) this.px[i * 3 + 1] += 0.01;
    const add = (a: number, b: number, temp = false) => {
      const d = Math.hypot(this.x[a * 3] - this.x[b * 3], this.x[a * 3 + 1] - this.x[b * 3 + 1], this.x[a * 3 + 2] - this.x[b * 3 + 2]);
      this.sticks.push({ a, b, len: d, temp });
    };
    // жёсткий торс
    const torso = [1, 2, 3, 4, 7, 8];
    for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) add(torso[i], torso[j]);
    add(0, 1);
    add(0, 3);
    add(0, 4);
    add(3, 5);
    add(4, 6);
    add(7, 9);
    add(8, 10);
    // мягкие ограничения, чтобы конечности не проходили сквозь торс
    add(5, 2);
    add(6, 2);
    add(9, 1);
    add(10, 1);
    // «мышцы»: временно держат позу
    this.holdTime = headshot ? 0 : 0.1 + Math.random() * 0.4;
    for (const [a, b] of [[5, 1], [6, 1], [9, 2], [10, 2], [9, 10], [5, 6], [0, 2]]) add(a, b, true);
  }

  update(dt: number) {
    if (this.sleeping) return;
    this.age += dt;
    if (this.age > this.holdTime && this.sticks.some((s) => s.temp)) this.sticks = this.sticks.filter((s) => !s.temp);
    const g = -18 * dt * dt;
    let motion = 0;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const vx = (this.x[o] - this.px[o]) * 0.99,
        vy = (this.x[o + 1] - this.px[o + 1]) * 0.99,
        vz = (this.x[o + 2] - this.px[o + 2]) * 0.99;
      this.px[o] = this.x[o];
      this.px[o + 1] = this.x[o + 1];
      this.px[o + 2] = this.x[o + 2];
      this.x[o] += vx;
      this.x[o + 1] += vy + g;
      this.x[o + 2] += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < 8; it++) {
      for (const s of this.sticks) {
        const a = s.a * 3,
          b = s.b * 3;
        const dx = this.x[b] - this.x[a],
          dy = this.x[b + 1] - this.x[a + 1],
          dz = this.x[b + 2] - this.x[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - s.len) / d / 2;
        // мягкие ограничения тянут только если сжались сильнее длины
        this.x[a] += dx * diff;
        this.x[a + 1] += dy * diff;
        this.x[a + 2] += dz * diff;
        this.x[b] -= dx * diff;
        this.x[b + 1] -= dy * diff;
        this.x[b + 2] -= dz * diff;
      }
      this.collide();
    }
    if (motion < 0.004 * NP && this.age > 0.8) {
      this.restTime += dt;
      if (this.restTime > 0.6) this.sleeping = true;
    } else this.restTime = 0;
  }

  private collide() {
    const r = 0.07;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const x = this.x[o],
        y = this.x[o + 1],
        z = this.x[o + 2];
      if (this.map.solidAt(x, y - r, z)) {
        const top = (Math.floor((y - r) / VOXEL) + 1) * VOXEL + r;
        if (top - y < 0.3) {
          this.x[o + 1] = top;
          // трение о землю
          this.px[o] = this.px[o] + (x - this.px[o]) * 0.35;
          this.px[o + 2] = this.px[o + 2] + (z - this.px[o + 2]) * 0.35;
        } else {
          // упёрлись в стену сбоку — откат по горизонтали
          this.x[o] = this.px[o];
          this.x[o + 2] = this.px[o + 2];
        }
      }
    }
  }

  /** Записать позу частей в формате computePose. */
  writePose(out: Float32Array) {
    const P = (i: number) => [this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]];
    const torsoRight = (() => {
      const a = P(3),
        b = P(4);
      const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(v[0], v[1], v[2]);
      return l > 1e-4 ? v.map((c) => c / l) : [this.rightX, 0, this.rightZ];
    })();
    const seg = (part: number, top: number[], bot: number[], center?: number[]) => {
      let ux = top[0] - bot[0],
        uy = top[1] - bot[1],
        uz = top[2] - bot[2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      // x = правый вектор, ортогонализованный к оси
      let rx = torsoRight[0],
        ry = torsoRight[1],
        rz = torsoRight[2];
      const dp = rx * ux + ry * uy + rz * uz;
      rx -= dp * ux;
      ry -= dp * uy;
      rz -= dp * uz;
      let rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-4) {
        rx = 1;
        ry = 0;
        rz = 0;
        rl = 1;
      }
      rx /= rl;
      ry /= rl;
      rz /= rl;
      // z = x × y
      const zx = ry * uz - rz * uy,
        zy = rz * ux - rx * uz,
        zz = rx * uy - ry * ux;
      const o = part * POSE_STRIDE;
      const c = center ?? [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2];
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = rx;
      out[o + 4] = ux;
      out[o + 5] = zx;
      out[o + 6] = ry;
      out[o + 7] = uy;
      out[o + 8] = zy;
      out[o + 9] = rz;
      out[o + 10] = uz;
      out[o + 11] = zz;
      out[o + 12] = 1;
    };
    const neck = P(1),
      pelvis = P(2),
      head = P(0);
    seg(PART_TORSO, neck, pelvis);
    seg(PART_HEAD, head, neck);
    seg(PART_ARM_L, P(3), P(5));
    seg(PART_ARM_R, P(4), P(6));
    seg(PART_LEG_L, P(7), P(9));
    seg(PART_LEG_R, P(8), P(10));
    void PART_COUNT;
  }
}
