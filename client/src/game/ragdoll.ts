// Рэгдолл на верле-точках (только клиент, косметика).
// 15 точек: колени и локти с ограничениями (колено гнётся вперёд, локоть — назад).
// Толчок от пули сильнее у задетой части, тело сохраняет скорость бега, крутится.
// Первые 0,1–0,5 с тело держит позу («мышцы»), при хедшоте сразу обмякает и оседает.

import { BVOX, PART_ARM_L, PART_ARM_R, PART_DIMS, PART_HEAD, PART_LEG_L, PART_LEG_R, PART_TORSO, POSE_STRIDE, VOXEL, VoxelMap } from '../../../shared/src/index';

/** На каком вокселе по высоте сгибаются руки (локоть) и ноги (колено). */
export const LIMB_SPLIT: Record<number, number> = { [PART_ARM_L]: 5, [PART_ARM_R]: 5, [PART_LEG_L]: 6, [PART_LEG_R]: 6 };
/** Сегменты для отрисовки: голова, торс, затем верх/низ каждой конечности. */
export const SEG_COUNT = 10;

// Точки
const TOP = 0,
  NECK = 1,
  PELVIS = 2,
  SH_L = 3,
  SH_R = 4,
  HAND_L = 5,
  HAND_R = 6,
  HIP_L = 7,
  HIP_R = 8,
  FOOT_L = 9,
  FOOT_R = 10,
  ELB_L = 11,
  ELB_R = 12,
  KNEE_L = 13,
  KNEE_R = 14;
const NP = 15;
/** Точки, уходящие вместе с оторванной частью. */
const DETACH: Record<number, number[]> = {
  [PART_HEAD]: [TOP],
  [PART_ARM_L]: [ELB_L, HAND_L],
  [PART_ARM_R]: [ELB_R, HAND_R],
  [PART_LEG_L]: [KNEE_L, FOOT_L],
  [PART_LEG_R]: [KNEE_R, FOOT_R],
};
const STEP = 1 / 120;

interface Stick {
  a: number;
  b: number;
  len: number;
  /** 0 — жёсткая, 1 — только «не ближе», 2 — временная («мышцы») */
  kind: 0 | 1 | 2;
}

type V3 = [number, number, number];

function partFrame(pose: Float32Array, p: number) {
  const o = p * POSE_STRIDE;
  const hy = (PART_DIMS[p][1] * BVOX * pose[o + 12]) / 2;
  const c: V3 = [pose[o], pose[o + 1], pose[o + 2]];
  const up: V3 = [pose[o + 4], pose[o + 7], pose[o + 10]];
  const at = (ly: number): V3 => [c[0] + up[0] * ly, c[1] + up[1] * ly, c[2] + up[2] * ly];
  return { hy, at };
}

export class Ragdoll {
  private x = new Float32Array(NP * 3);
  private px = new Float32Array(NP * 3);
  private sticks: Stick[] = [];
  private age = 0;
  private holdTime: number;
  private restTime = 0;
  private acc = 0;
  sleeping = false;
  /** точки оторванных частей: без связей с телом и без ограничений суставов */
  private free = new Uint8Array(NP);

  constructor(
    private map: VoxelMap,
    pose: Float32Array,
    impulse: V3,
    hitPart: number,
    headshot: boolean,
    vel: V3 = [0, 0, 0],
  ) {
    const head = partFrame(pose, PART_HEAD);
    const torso = partFrame(pose, PART_TORSO);
    const pts: V3[] = new Array(NP);
    pts[TOP] = head.at(head.hy);
    pts[NECK] = torso.at(torso.hy);
    pts[PELVIS] = torso.at(-torso.hy);
    for (const [part, top, joint, end] of [
      [PART_ARM_L, SH_L, ELB_L, HAND_L],
      [PART_ARM_R, SH_R, ELB_R, HAND_R],
      [PART_LEG_L, HIP_L, KNEE_L, FOOT_L],
      [PART_LEG_R, HIP_R, KNEE_R, FOOT_R],
    ] as const) {
      const f = partFrame(pose, part);
      pts[top] = f.at(f.hy);
      pts[joint] = f.at(-f.hy + LIMB_SPLIT[part] * BVOX);
      pts[end] = f.at(-f.hy);
    }
    for (let i = 0; i < NP; i++) for (let k = 0; k < 3; k++) this.x[i * 3 + k] = pts[i][k];

    // вектор «вперёд» тела — для сгиба колен и разворота
    const fwd = this.forward();
    const rnd = (a: number) => (Math.random() * 2 - 1) * a;
    // точка попадания — центр задетой части
    const hf = partFrame(pose, hitPart);
    const hit = hf.at(0);
    const spin = rnd(0.8); // разворот: плечи и бёдра толкаются в разные стороны
    const right = this.right();
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const d2 = (this.x[o] - hit[0]) ** 2 + (this.x[o + 1] - hit[1]) ** 2 + (this.x[o + 2] - hit[2]) ** 2;
      const w = 0.25 + 1.1 * Math.exp(-d2 / 0.1);
      // убитый на бегу ещё немного проносится вперёд (ноги — меньше: они «подсекаются»)
      const keep = i === FOOT_L || i === FOOT_R || i === KNEE_L || i === KNEE_R ? 0.2 : 0.5;
      let vx = vel[0] * keep + impulse[0] * w,
        vy = vel[1] * 0.3 + impulse[1] * w,
        vz = vel[2] * keep + impulse[2] * w;
      // закрут: верх тела в одну сторону, ноги — в другую
      const h = this.x[o + 1] - pts[PELVIS][1];
      vx += right[0] * spin * h;
      vz += right[2] * spin * h;
      if (headshot) {
        // хедшот: ноги подламываются, тело оседает
        if (i === KNEE_L || i === KNEE_R) {
          vx += fwd[0] * 1.6;
          vz += fwd[2] * 1.6;
        }
        if (i === PELVIS || i === HIP_L || i === HIP_R) vy -= 1.2;
      }
      this.px[o] = this.x[o] - vx * STEP;
      this.px[o + 1] = this.x[o + 1] - vy * STEP;
      this.px[o + 2] = this.x[o + 2] - vz * STEP;
    }

    const add = (a: number, b: number, kind: Stick['kind'] = 0, scale = 1) => {
      const d = Math.hypot(this.x[a * 3] - this.x[b * 3], this.x[a * 3 + 1] - this.x[b * 3 + 1], this.x[a * 3 + 2] - this.x[b * 3 + 2]);
      this.sticks.push({ a, b, len: d * scale, kind });
    };
    // жёсткий торс
    const t = [NECK, PELVIS, SH_L, SH_R, HIP_L, HIP_R];
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) add(t[i], t[j]);
    // голова держится на шее, но может наклоняться
    add(TOP, NECK);
    add(TOP, SH_L, 1, 0.9);
    add(TOP, SH_R, 1, 0.9);
    // конечности из двух звеньев
    add(SH_L, ELB_L);
    add(ELB_L, HAND_L);
    add(SH_R, ELB_R);
    add(ELB_R, HAND_R);
    add(HIP_L, KNEE_L);
    add(KNEE_L, FOOT_L);
    add(HIP_R, KNEE_R);
    add(KNEE_R, FOOT_R);
    // суставы не складываются полностью
    add(SH_L, HAND_L, 1, 0.45);
    add(SH_R, HAND_R, 1, 0.45);
    add(HIP_L, FOOT_L, 1, 0.55);
    add(HIP_R, FOOT_R, 1, 0.55);
    // конечности не проходят сквозь торс и друг друга
    add(HAND_L, PELVIS, 1, 0.5);
    add(HAND_R, PELVIS, 1, 0.5);
    add(KNEE_L, KNEE_R, 1, 0.6);
    add(FOOT_L, FOOT_R, 1, 0.5);
    add(FOOT_L, NECK, 1, 0.8);
    add(FOOT_R, NECK, 1, 0.8);
    // «мышцы»: временно держат позу
    this.holdTime = headshot ? 0 : 0.1 + Math.random() * 0.4;
    if (!headshot)
      for (const [a, b] of [
        [HAND_L, NECK],
        [HAND_R, NECK],
        [FOOT_L, PELVIS],
        [FOOT_R, PELVIS],
        [KNEE_L, PELVIS],
        [KNEE_R, PELVIS],
        [ELB_L, PELVIS],
        [ELB_R, PELVIS],
        [TOP, PELVIS],
      ])
        add(a, b, 2);
  }

  /**
   * Оторвать часть: её точки (голова — макушка, рука — локоть и кисть, нога — колено и стопа) теряют связи
   * с остальным телом. Плечи и бёдра — часть жёсткого торса и остаются: тело ложится на землю обрубком,
   * а не висит на невидимых ногах.
   */
  detach(part: number) {
    const pts = DETACH[part];
    if (!pts) return;
    for (const i of pts) this.free[i] = 1;
    this.sticks = this.sticks.filter((s) => this.free[s.a] === this.free[s.b]);
    this.sleeping = false;
    this.restTime = 0;
  }

  private p(i: number): V3 {
    return [this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]];
  }

  private right(): V3 {
    const a = this.p(SH_L),
      b = this.p(SH_R);
    const v: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /** Вперёд = вверх × вправо (перед тела — сторона, куда смотрит лицо). */
  private forward(): V3 {
    const n = this.p(NECK),
      pe = this.p(PELVIS);
    const up: V3 = [n[0] - pe[0], n[1] - pe[1], n[2] - pe[2]];
    const r = this.right();
    const f: V3 = [up[1] * r[2] - up[2] * r[1], up[2] * r[0] - up[0] * r[2], up[0] * r[1] - up[1] * r[0]];
    const l = Math.hypot(...f) || 1;
    return [f[0] / l, f[1] / l, f[2] / l];
  }

  update(dt: number) {
    if (this.sleeping) return;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP && !this.sleeping) {
      this.acc -= STEP;
      this.step();
    }
  }

  private step() {
    this.age += STEP;
    if (this.age > this.holdTime && this.sticks.some((s) => s.kind === 2)) this.sticks = this.sticks.filter((s) => s.kind !== 2);
    const g = -18 * STEP * STEP;
    let motion = 0;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const vx = (this.x[o] - this.px[o]) * 0.993,
        vy = (this.x[o + 1] - this.px[o + 1]) * 0.997,
        vz = (this.x[o + 2] - this.px[o + 2]) * 0.993;
      this.px[o] = this.x[o];
      this.px[o + 1] = this.x[o + 1];
      this.px[o + 2] = this.x[o + 2];
      this.x[o] += vx;
      this.x[o + 1] += vy + g;
      this.x[o + 2] += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < 10; it++) {
      for (const s of this.sticks) {
        const a = s.a * 3,
          b = s.b * 3;
        const dx = this.x[b] - this.x[a],
          dy = this.x[b + 1] - this.x[a + 1],
          dz = this.x[b + 2] - this.x[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (s.kind === 1 && d >= s.len) continue; // «не ближе чем»
        const diff = ((d - s.len) / d) * 0.5 * (s.kind === 2 ? 0.6 : 1);
        this.x[a] += dx * diff;
        this.x[a + 1] += dy * diff;
        this.x[a + 2] += dz * diff;
        this.x[b] -= dx * diff;
        this.x[b + 1] -= dy * diff;
        this.x[b + 2] -= dz * diff;
      }
      this.joints();
      this.collide();
    }
    if (motion < 0.0012 * NP && this.age > 0.8) {
      this.restTime += STEP;
      if (this.restTime > 0.5) this.sleeping = true;
    } else this.restTime = 0;
  }

  /** Колено — только вперёд от линии бедро–стопа, локоть — только назад от линии плечо–кисть. */
  private joints() {
    const f = this.forward();
    for (const [a, j, b, sign] of [
      [HIP_L, KNEE_L, FOOT_L, 1],
      [HIP_R, KNEE_R, FOOT_R, 1],
      [SH_L, ELB_L, HAND_L, -1],
      [SH_R, ELB_R, HAND_R, -1],
    ] as const) {
      if (this.free[j]) continue;
      const ja = j * 3;
      const mx = (this.x[a * 3] + this.x[b * 3]) / 2,
        my = (this.x[a * 3 + 1] + this.x[b * 3 + 1]) / 2,
        mz = (this.x[a * 3 + 2] + this.x[b * 3 + 2]) / 2;
      const d = ((this.x[ja] - mx) * f[0] + (this.x[ja + 1] - my) * f[1] + (this.x[ja + 2] - mz) * f[2]) * sign;
      if (d < 0) {
        // коррекция без добавления импульса: сустав в одну сторону, концы звена — в другую
        const cx = -f[0] * d * sign,
          cy = -f[1] * d * sign,
          cz = -f[2] * d * sign;
        this.x[ja] += cx * (2 / 3);
        this.x[ja + 1] += cy * (2 / 3);
        this.x[ja + 2] += cz * (2 / 3);
        for (const e of [a * 3, b * 3]) {
          this.x[e] -= cx / 3;
          this.x[e + 1] -= cy / 3;
          this.x[e + 2] -= cz / 3;
        }
      }
    }
  }

  private collide() {
    const r = 0.06;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const x = this.x[o],
        y = this.x[o + 1],
        z = this.x[o + 2];
      if (!this.map.solidAt(x, y - r, z)) continue;
      const top = (Math.floor((y - r) / VOXEL) + 1) * VOXEL + r;
      if (top - y < 0.3) {
        this.x[o + 1] = top;
        if (this.px[o + 1] < top) this.px[o + 1] = top;
        // трение о землю: точка почти не скользит
        this.px[o] += (x - this.px[o]) * 0.6;
        this.px[o + 2] += (z - this.px[o + 2]) * 0.6;
      } else {
        // упёрлись в стену сбоку — откат по горизонтали
        this.x[o] = this.px[o];
        this.x[o + 2] = this.px[o + 2];
      }
    }
  }

  /** Записать преобразования 10 сегментов (формат как у позы: центр, матрица по строкам, масштаб). */
  writeSegments(out: Float32Array) {
    const P = (i: number) => this.p(i);
    const rgt = this.right();
    const put = (seg: number, top: V3, bot: V3, anchor: V3, anchorLocalY: number) => {
      let ux = top[0] - bot[0],
        uy = top[1] - bot[1],
        uz = top[2] - bot[2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      let rx = rgt[0],
        ry = rgt[1],
        rz = rgt[2];
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
      const zx = ry * uz - rz * uy,
        zy = rz * ux - rx * uz,
        zz = rx * uy - ry * ux;
      const o = seg * POSE_STRIDE;
      // центр части: точка-якорь минус её локальное смещение по оси
      out[o] = anchor[0] - ux * anchorLocalY;
      out[o + 1] = anchor[1] - uy * anchorLocalY;
      out[o + 2] = anchor[2] - uz * anchorLocalY;
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
    const half = (p: number) => (PART_DIMS[p][1] * BVOX) / 2;
    put(0, P(TOP), P(NECK), P(NECK), -half(PART_HEAD));
    put(1, P(NECK), P(PELVIS), P(NECK), half(PART_TORSO));
    let seg = 2;
    for (const [part, top, joint, end] of [
      [PART_ARM_L, SH_L, ELB_L, HAND_L],
      [PART_ARM_R, SH_R, ELB_R, HAND_R],
      [PART_LEG_L, HIP_L, KNEE_L, FOOT_L],
      [PART_LEG_R, HIP_R, KNEE_R, FOOT_R],
    ] as const) {
      const jy = -half(part) + LIMB_SPLIT[part] * BVOX; // локальная высота сустава
      put(seg++, P(top), P(joint), P(joint), jy); // верхнее звено
      put(seg++, P(joint), P(end), P(joint), jy); // нижнее звено
    }
  }
}
