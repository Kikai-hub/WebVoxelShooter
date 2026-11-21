// Анимация воксельных агентов: только картинка, по тому, что клиент и так знает о чужом игроке
// (интерполированная позиция, поворот, флаги присед / на земле / перезарядка, события выстрела).
// Хитбоксы на сервере считаются по позе без анимации, поэтому на попадания это не влияет.

import { BODY_LEG_H, CROUCH_SPEED, newPoseAnim, RUN_SPEED, type PoseAnim } from '../../../shared/src/index';

const TAU = Math.PI * 2;
/** длина полного цикла шага (два шага), м */
const STRIDE_RUN = 2.6;
const STRIDE_CROUCH = 1.3;

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Плавное приближение к цели с постоянной времени 1/rate. */
function approach(v: number, target: number, rate: number, dt: number): number {
  return target + (v - target) * Math.exp(-rate * dt);
}

export interface AnimInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  crouch: boolean;
  onGround: boolean;
  reloading: boolean;
  /** вид оружия: у ножа и гранаты руки двигаются иначе */
  weaponKind: string;
  /** закладывает или обезвреживает бомбу */
  using?: boolean;
}

export class AgentAnimator {
  readonly pose: PoseAnim = newPoseAnim();
  private init = false;
  private px = 0;
  private py = 0;
  private pz = 0;
  private pyaw = 0;
  /** сглаженная скорость в осях тела: вперёд и вбок, м/с */
  private vf = 0;
  private vs = 0;
  private vy = 0;
  private yawRate = 0;
  private phase = 0;
  private crouch = 0;
  private air = 0;
  private airTime = 0;
  private land = 0;
  private kick = 0;
  private reload = 0;
  private reloadT = 0;
  private use = 0;
  private useT = 0;
  private t = Math.random() * 10;

  /** Выстрел этого игрока: руки и плечи подбрасывает отдачей. */
  fire(kind: string) {
    this.kick = kind === 'sniper' || kind === 'shotgun' ? 1.4 : kind === 'knife' ? 0.8 : kind === 'grenade' ? 1 : 0.7;
  }

  /** Телепорт (возрождение, появление из-за стены): не считаем это движением. */
  reset() {
    this.init = false;
  }

  update(dt: number, s: AnimInput): PoseAnim {
    const a = this.pose;
    if (dt <= 0) return a;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (!this.init || Math.hypot(s.x - this.px, s.z - this.pz) > 2) {
      this.init = true;
      this.px = s.x;
      this.py = s.y;
      this.pz = s.z;
      this.pyaw = s.yaw;
      this.crouch = s.crouch ? 1 : 0;
    }
    // скорость в осях тела (перед — −Z при yaw = 0)
    const dx = (s.x - this.px) / dt,
      dz = (s.z - this.pz) / dt;
    const sy = Math.sin(s.yaw),
      cy = Math.cos(s.yaw);
    const f = -sy * dx - cy * dz;
    const st = cy * dx - sy * dz;
    this.vf = approach(this.vf, f, 12, dt);
    this.vs = approach(this.vs, st, 12, dt);
    this.vy = approach(this.vy, (s.y - this.py) / dt, 20, dt);
    this.yawRate = approach(this.yawRate, angDiff(this.pyaw, s.yaw) / dt, 10, dt);
    this.px = s.x;
    this.py = s.y;
    this.pz = s.z;
    this.pyaw = s.yaw;

    this.use = approach(this.use, s.using ? 1 : 0, 10, dt);
    this.useT = s.using ? this.useT + dt : 0;
    // на колене: тело опускается как в приседе
    this.crouch = approach(this.crouch, s.crouch || s.using ? 1 : 0, 14, dt);
    const wasAir = this.air > 0.5;
    this.air = approach(this.air, s.onGround ? 0 : 1, s.onGround ? 18 : 10, dt);
    this.airTime = s.onGround ? 0 : this.airTime + dt;
    if (wasAir && s.onGround) this.land = Math.min(1, 0.4 + this.airTime * 2);
    this.land = approach(this.land, 0, 9, dt);
    this.kick = approach(this.kick, 0, 13, dt);
    this.reloadT = s.reloading ? this.reloadT + dt : 0;
    this.reload = approach(this.reload, s.reloading ? 1 : 0, 8, dt);

    const speed = Math.hypot(this.vf, this.vs);
    const maxSpeed = this.crouch > 0.5 ? CROUCH_SPEED : RUN_SPEED;
    const run = Math.min(1, speed / maxSpeed); // 0 — стоит, 1 — полный бег
    // фаза шага: по пройденному пути; назад — в обратную сторону
    const stride = STRIDE_RUN + (STRIDE_CROUCH - STRIDE_RUN) * this.crouch;
    const dirSign = this.vf < -0.3 * speed ? -1 : 1;
    let amp = 0;
    if (speed > 0.25) {
      this.phase += ((dirSign * speed) / stride) * TAU * dt;
      amp = (0.18 + 0.4 * run) * (1 - 0.45 * this.crouch);
    } else if (Math.abs(this.yawRate) > 1.2) {
      // переступание при повороте на месте
      this.phase += Math.sign(this.yawRate) * 7 * dt;
      amp = Math.min(0.16, Math.abs(this.yawRate) * 0.04);
    } else {
      // остановка: ноги доходят до ближайшего «вместе»
      const target = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase = approach(this.phase, target, 8, dt);
      amp = Math.min(0.3, Math.abs(Math.sin(this.phase)) * 0.3);
    }
    if (this.phase > 1e4 || this.phase < -1e4) this.phase %= TAU;
    const sw = Math.sin(this.phase),
      cw = Math.cos(this.phase);

    // присед: бёдра опускаются, бедро вперёд, колено назад, стопа под тазом
    const hipH = Math.max(0.05, BODY_LEG_H - 0.5 * this.crouch);
    const squat = Math.acos(Math.min(1, hipH / BODY_LEG_H));
    let legL = squat + amp * sw,
      legR = squat - amp * sw;
    // колено сгибается у ноги, которая идёт вперёд (в переносе)
    const kneeAmp = amp * 1.5;
    let kneeL = 2 * squat + kneeAmp * Math.max(0, cw * dirSign) + 0.08 * run,
      kneeR = 2 * squat + kneeAmp * Math.max(0, -cw * dirSign) + 0.08 * run;

    // прыжок: ноги поджаты, одна впереди
    const air = this.air;
    if (air > 0.01) {
      const up = this.vy > 0 ? 1 : 0.6;
      legL += (0.55 * up - legL + squat) * air;
      legR += (-0.05 - legR + squat) * air;
      kneeL += (1.1 - kneeL + 2 * squat) * air;
      kneeR += (0.7 - kneeR + 2 * squat) * air;
    }
    // приземление: ноги пружинят
    kneeL += this.land * 0.5;
    kneeR += this.land * 0.5;
    legL += this.land * 0.25;
    legR += this.land * 0.25;

    // закладка/обезвреживание: левая нога согнута впереди, правое колено на земле
    const u = this.use;
    if (u > 0.01) {
      legL += (1.15 - legL) * u;
      kneeL += (1.7 - kneeL) * u;
      legR += (-0.05 - legR) * u;
      kneeR += (1.6 - kneeR) * u;
    }
    a.crouch = this.crouch;
    a.legL = legL;
    a.legR = legR;
    a.kneeL = Math.max(0, kneeL);
    a.kneeR = Math.max(0, kneeR);
    // тело опускается в широком шаге и при приземлении; дыхание на месте
    const stanceDrop = BODY_LEG_H * (1 - Math.cos(amp * sw)) * 0.55;
    const breath = Math.sin(this.t * 1.7) * 0.006 * (1 - run);
    a.bob = -stanceDrop - this.land * 0.09 + breath;
    // наклон вперёд на бегу, назад при беге спиной, лёгкий откат при выстреле
    a.lean = -0.16 * run * (dirSign > 0 ? Math.min(1, Math.max(0.3, this.vf / Math.max(speed, 1e-3))) : -0.5) + 0.05 * this.kick - 0.08 * this.land;
    // руки: на бегу оружие ниже и покачивается, отдача подбрасывает
    const melee = s.weaponKind === 'knife' || s.weaponKind === 'grenade';
    a.armPitch = -0.14 * run * (melee ? 1.6 : 1) + 0.05 * Math.sin(this.phase * 2) * run + 0.22 * this.kick + breath * 2;
    // перезарядка: левая рука уходит к магазину и возвращается, оружие наклоняется
    a.reload = this.reload * (0.85 + 0.15 * Math.sin(this.reloadT * 9));
    a.armPitch -= 0.3 * this.reload;
    a.weapon = s.weaponKind;
    a.headYaw = 0;
    // наклон к бомбе
    a.use = u;
    a.useT = this.useT;
    a.lean -= 0.45 * u;
    a.armPitch *= 1 - u;
    return a;
  }
}
