// Визуал взрыва: огненный шар из кубиков (белый → оранжевый → серый дым), ударная волна кольцом
// по земле и одна переиспользуемая вспышка-лампа. Один InstancedMesh и один PointLight на всё:
// ничего не создаётся на каждый взрыв, одновременно живут не больше SLOTS взрывов.
// Искры и осколки вокселей рисует общая система Debris (вызывает game.ts).

import * as THREE from 'three';

const SLOTS = 4;
const BALL = 56; // кубиков в огненном шаре
const RING = 32; // кубиков в ударной волне
const PER = BALL + RING;

// ключевые цвета шара по возрасту u = 0..1: белый → жёлтый → оранжевый → красно-серый → серый
const KEYS = [
  { u: 0, c: [1, 1, 0.9] },
  { u: 0.14, c: [1, 0.86, 0.4] },
  { u: 0.34, c: [1, 0.46, 0.08] },
  { u: 0.58, c: [0.34, 0.2, 0.15] },
  { u: 1, c: [0.22, 0.22, 0.22] },
];

interface Slot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  start: number;
  dur: number;
  radius: number; // конечный радиус шара, м
  wave: number; // конечный радиус ударной волны, м
  dir: Float32Array; // BALL*3 — направление кубика
  spd: Float32Array; // BALL — доля радиуса
  sz: Float32Array; // BALL — размер
  age: Float32Array; // BALL — сдвиг «возраста» (одни остывают раньше)
  ringPhase: Float32Array; // RING — угол
}

export class ExplosionFx {
  readonly mesh: THREE.InstancedMesh;
  /** Одна лампа на все взрывы. Добавляется в сцену один раз при создании, чтобы не перекомпилировались шейдеры. */
  readonly light: THREE.PointLight;
  private slots: Slot[] = [];
  private next = 0;
  private m4 = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private col = new THREE.Color();
  private lightEnd = 0;
  private lightStart = 0;
  private lightPeak = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), SLOTS * PER);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SLOTS * PER; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.col.set(0xffffff));
    }
    for (let s = 0; s < SLOTS; s++) {
      this.slots.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        start: 0,
        dur: 1,
        radius: 1,
        wave: 1,
        dir: new Float32Array(BALL * 3),
        spd: new Float32Array(BALL),
        sz: new Float32Array(BALL),
        age: new Float32Array(BALL),
        ringPhase: new Float32Array(RING),
      });
    }
    this.light = new THREE.PointLight(0xffa040, 0, 16, 1.6);
    this.light.visible = true;
  }

  /** big — бомба (больше и дольше), иначе осколочная. */
  spawn(x: number, y: number, z: number, big: boolean, now: number) {
    const s = this.slots[this.next];
    this.next = (this.next + 1) % SLOTS;
    s.active = true;
    s.x = x;
    s.y = y;
    s.z = z;
    s.start = now;
    s.dur = big ? 1.7 : 1.15;
    s.radius = big ? 4.2 : 2.1;
    s.wave = big ? 11 : 5.5;
    for (let i = 0; i < BALL; i++) {
      // направление в сфере, смещённое вверх: шар «всплывает»
      let a, b, c, l;
      do {
        a = Math.random() * 2 - 1;
        b = Math.random() * 2 - 1;
        c = Math.random() * 2 - 1;
        l = a * a + b * b + c * c;
      } while (l > 1 || l < 0.05);
      const k = 1 / Math.sqrt(l);
      s.dir[i * 3] = a * k;
      s.dir[i * 3 + 1] = Math.abs(b * k) * 0.85 + 0.1;
      s.dir[i * 3 + 2] = c * k;
      const core = i < 12; // ядро — ближе к центру, мельче, дольше белое
      s.spd[i] = core ? 0.25 + Math.random() * 0.3 : 0.55 + Math.random() * 0.45;
      s.sz[i] = (core ? 0.45 : 0.3) + Math.random() * 0.35;
      s.age[i] = core ? -0.05 : Math.random() * 0.12;
    }
    for (let i = 0; i < RING; i++) s.ringPhase[i] = (i / RING) * Math.PI * 2 + Math.random() * 0.15;
    // вспышка света
    this.light.position.set(x, y + 0.7, z);
    this.light.distance = big ? 30 : 16;
    this.lightPeak = big ? 14 : 8;
    this.lightStart = now;
    this.lightEnd = now + 0.15;
    this.light.intensity = this.lightPeak;
  }

  clear() {
    for (let i = 0; i < SLOTS * PER; i++) this.mesh.setMatrixAt(i, this.zero);
    for (const s of this.slots) s.active = false;
    this.light.intensity = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private ballColor(u: number, out: THREE.Color) {
    if (u >= 1) return out.setRGB(0.22, 0.22, 0.22);
    let k = 1;
    while (k < KEYS.length - 1 && KEYS[k].u < u) k++;
    const a = KEYS[k - 1],
      b = KEYS[k];
    const f = Math.min(1, Math.max(0, (u - a.u) / (b.u - a.u)));
    return out.setRGB(a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f);
  }

  update(now: number) {
    // вспышка: линейно гаснет за 0,15 с
    if (this.light.intensity > 0) {
      const f = 1 - (now - this.lightStart) / (this.lightEnd - this.lightStart);
      this.light.intensity = f > 0 ? this.lightPeak * f : 0;
    }
    let dirty = false;
    for (let si = 0; si < SLOTS; si++) {
      const s = this.slots[si];
      if (!s.active) continue;
      dirty = true;
      const base = si * PER;
      const t = now - s.start;
      if (t >= s.dur) {
        for (let i = 0; i < PER; i++) this.mesh.setMatrixAt(base + i, this.zero);
        s.active = false;
        continue;
      }
      const u0 = t / s.dur;
      const grow = 1 - Math.exp(-t * 7);
      const shrink = u0 > 0.65 ? Math.max(0, 1 - (u0 - 0.65) / 0.35) : 1;
      for (let i = 0; i < BALL; i++) {
        const u = Math.max(0, u0 + s.age[i]);
        const r = s.radius * s.spd[i] * grow;
        // дым всплывает после основного расширения
        const rise = Math.max(0, t - 0.25) * (0.8 + s.spd[i]) * (s.radius * 0.3);
        const size = s.sz[i] * s.radius * (0.45 + 0.8 * grow) * (u > 0.5 ? shrink : 1);
        this.m4.makeScale(size, size, size);
        this.m4.setPosition(s.x + s.dir[i * 3] * r, s.y + 0.15 + s.dir[i * 3 + 1] * r + rise, s.z + s.dir[i * 3 + 2] * r);
        this.mesh.setMatrixAt(base + i, this.m4);
        this.mesh.setColorAt(base + i, this.ballColor(u, this.col));
      }
      // ударная волна: кольцо быстро растёт по земле и гаснет за ~0,5 с
      const wt = t / 0.5;
      if (wt < 1) {
        const rr = s.wave * (1 - (1 - wt) * (1 - wt));
        const size = 0.3 * (1 - wt) + 0.06;
        const lum = 0.75 + 0.25 * (1 - wt);
        for (let i = 0; i < RING; i++) {
          const a = s.ringPhase[i];
          this.m4.makeScale(size * 1.6, size, size * 1.6);
          this.m4.setPosition(s.x + Math.cos(a) * rr, s.y + 0.08, s.z + Math.sin(a) * rr);
          this.mesh.setMatrixAt(base + BALL + i, this.m4);
          this.mesh.setColorAt(base + BALL + i, this.col.setRGB(lum, lum * 0.92, lum * 0.78));
        }
      } else if (wt < 1.2) {
        for (let i = 0; i < RING; i++) this.mesh.setMatrixAt(base + BALL + i, this.zero);
      }
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
