// Отрисовка гранат в полёте, воксельного дыма и оружия на земле.

import * as THREE from 'three';
import { DT, SMOKE_RADIUS, WEAPONS, stepNade, type NadeState, type VoxelMap } from '../../../shared/src/index';
import { buildGun } from './viewmodel';
import { disposeGun } from './weaponModels';

const NADE_COLORS = [0x4f6b32, 0x9aa0a6, 0xd9d9d4, 0x8a5a24];

const FLAMES = 200;
const MAX_FIRES = 4;
const FLAME_COLORS = [0xffe27a, 0xffb43a, 0xff7a1a, 0xe8461a, 0x3a2a22];

/**
 * Огонь зажигательной: кубики пламени по кругу радиусом r на полу, каждый поднимается,
 * мерцает и рождается заново; к концу горения огонь опадает. Без источников света
 * (смена их числа перекомпилирует шейдеры — рывок посреди боя).
 */
export class FireView {
  readonly mesh: THREE.InstancedMesh;
  private fires: Array<{ id: number; x: number; y: number; z: number; r: number; start: number; end: number; off: Float32Array; phase: Float32Array } | null> = [];
  private m4 = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private col = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshBasicMaterial({ toneMapped: false }), FLAMES * MAX_FIRES);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FLAMES * MAX_FIRES; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.col.set(FLAME_COLORS[i % FLAME_COLORS.length]));
    }
    for (let i = 0; i < MAX_FIRES; i++) this.fires.push(null);
  }

  /** left — сколько секунд гореть (для поздно вошедших — остаток). */
  add(id: number, x: number, y: number, z: number, r: number, left: number, total: number, now: number) {
    let slot = this.fires.findIndex((f) => !f);
    if (slot < 0) slot = this.fires.reduce((best, f, i) => (f && f.end < (this.fires[best]?.end ?? Infinity) ? i : best), 0);
    const off = new Float32Array(FLAMES * 2);
    const phase = new Float32Array(FLAMES);
    for (let i = 0; i < FLAMES; i++) {
      // равномерно по кругу, чуть гуще к центру
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 0.7) * r;
      off[i * 2] = Math.cos(a) * d;
      off[i * 2 + 1] = Math.sin(a) * d;
      phase[i] = Math.random();
    }
    this.fires[slot] = { id, x, y, z, r, start: now - (total - left), end: now + left, off, phase };
  }

  remove(id: number) {
    const i = this.fires.findIndex((f) => f?.id === id);
    if (i < 0) return;
    for (let k = 0; k < FLAMES; k++) this.mesh.setMatrixAt(i * FLAMES + k, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fires[i] = null;
  }

  clear() {
    for (const f of this.fires) if (f) this.remove(f.id);
  }

  update(now: number) {
    let dirty = false;
    for (let s = 0; s < MAX_FIRES; s++) {
      const f = this.fires[s];
      if (!f) continue;
      dirty = true;
      if (now > f.end) {
        this.remove(f.id);
        continue;
      }
      const grow = Math.min(1, (now - f.start) / 0.4);
      const fade = Math.min(1, (f.end - now) / 1.2);
      const base = s * FLAMES;
      for (let i = 0; i < FLAMES; i++) {
        // жизнь кубика: 0,6 с подъёма, затем снова снизу
        const life = (now * 1.7 + f.phase[i]) % 1;
        const rise = life * (0.5 + 0.9 * fade);
        const sz = (1 - life) * (0.7 + 0.6 * Math.sin(now * 13 + i)) * grow * fade + 0.05;
        this.m4.makeScale(sz * 1.4, sz * 2.2, sz * 1.4);
        this.m4.setPosition(f.x + f.off[i * 2] * grow, f.y + 0.08 + rise, f.z + f.off[i * 2 + 1] * grow);
        this.mesh.setMatrixAt(base + i, this.m4);
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Гранаты в полёте: клиент считает тот же полёт, что и сервер, по событию броска. */
export class NadeView {
  readonly group = new THREE.Group();
  private flying = new Map<number, { st: NadeState; mesh: THREE.Mesh; acc: number }>();
  private geo = new THREE.BoxGeometry(0.1, 0.13, 0.1);

  /** onBounce — граната ударилась о поверхность (x, y, z, скорость удара); звук играет клиент по своей симуляции */
  constructor(
    private map: () => VoxelMap,
    private onBounce?: (x: number, y: number, z: number, speed: number) => void,
  ) {}

  spawn(id: number, type: number, p: [number, number, number], v: [number, number, number], ticksAhead: number) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshLambertMaterial({ color: NADE_COLORS[type] ?? 0x666666 }));
    const st: NadeState = { x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], resting: false };
    for (let i = 0; i < Math.min(64, ticksAhead); i++) stepNade(st, this.map());
    mesh.position.set(st.x, st.y, st.z);
    this.group.add(mesh);
    this.flying.set(id, { st, mesh, acc: 0 });
  }

  remove(id: number) {
    const f = this.flying.get(id);
    if (!f) return;
    this.group.remove(f.mesh);
    (f.mesh.material as THREE.Material).dispose();
    this.flying.delete(id);
  }

  update(dt: number) {
    for (const f of this.flying.values()) {
      f.acc += dt;
      while (f.acc >= DT) {
        f.acc -= DT;
        const hit = stepNade(f.st, this.map());
        if (hit > 0) this.onBounce?.(f.st.x, f.st.y, f.st.z, hit);
      }
      f.mesh.position.set(f.st.x, f.st.y, f.st.z);
      if (!f.st.resting) {
        f.mesh.rotation.x += dt * 9;
        f.mesh.rotation.z += dt * 6;
      }
    }
  }

  clear() {
    for (const id of [...this.flying.keys()]) this.remove(id);
  }
}

const CUBES = 240;
const MAX_CLOUDS = 6;

/** Дым из воксельных кубиков: непрозрачный, растёт за 0,8 с, тает в конце. */
export class SmokeView {
  readonly mesh: THREE.InstancedMesh;
  private clouds: Array<{ x: number; y: number; z: number; start: number; end: number; off: Float32Array; size: Float32Array } | null> = [];
  private next = 0;
  private m4 = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private col = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial(), CUBES * MAX_CLOUDS);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CUBES * MAX_CLOUDS; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      const g = 0.78 + Math.random() * 0.14;
      this.mesh.setColorAt(i, this.col.setRGB(g, g, g * 0.97));
    }
    for (let i = 0; i < MAX_CLOUDS; i++) this.clouds.push(null);
  }

  /** left — сколько секунд дыму осталось (для поздно вошедших). */
  add(x: number, y: number, z: number, left: number, now: number) {
    const off = new Float32Array(CUBES * 3);
    const size = new Float32Array(CUBES);
    for (let i = 0; i < CUBES; i++) {
      // точка в «приплюснутом» шаре, плотнее к центру
      let a, b, c;
      do {
        a = Math.random() * 2 - 1;
        b = Math.random() * 2 - 1;
        c = Math.random() * 2 - 1;
      } while (a * a + b * b + c * c > 1);
      off[i * 3] = a * SMOKE_RADIUS;
      off[i * 3 + 1] = (b * 0.5 + 0.5) * 2.6;
      off[i * 3 + 2] = c * SMOKE_RADIUS;
      size[i] = 0.8 + Math.random() * 0.9;
    }
    const total = 15;
    this.clouds[this.next] = { x, y, z, start: now - (total - left), end: now + left, off, size };
    this.next = (this.next + 1) % MAX_CLOUDS;
  }

  clear() {
    for (let i = 0; i < MAX_CLOUDS; i++) this.clouds[i] = null;
    for (let i = 0; i < CUBES * MAX_CLOUDS; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(now: number) {
    let dirty = false;
    for (let c = 0; c < MAX_CLOUDS; c++) {
      const cl = this.clouds[c];
      const base = c * CUBES;
      if (!cl) continue;
      dirty = true;
      if (now > cl.end) {
        for (let i = 0; i < CUBES; i++) this.mesh.setMatrixAt(base + i, this.zero);
        this.clouds[c] = null;
        continue;
      }
      const grow = Math.min(1, (now - cl.start) / 0.8);
      const fade = Math.min(1, (cl.end - now) / 1.5);
      const t = now - cl.start;
      for (let i = 0; i < CUBES; i++) {
        const k = grow * (0.6 + 0.4 * fade);
        const s = cl.size[i] * Math.min(1, grow * 1.5) * fade;
        const drift = Math.sin(t * 0.4 + i) * 0.15;
        this.m4.makeScale(s, s, s);
        this.m4.setPosition(cl.x + cl.off[i * 3] * k + drift, cl.y + 0.3 + cl.off[i * 3 + 1] * grow + t * 0.01, cl.z + cl.off[i * 3 + 2] * k);
        this.mesh.setMatrixAt(base + i, this.m4);
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Оружие на земле — те же блочные модели, что от первого лица, лежащие на боку. */
export class DropsView {
  readonly group = new THREE.Group();
  private items = new Map<number, THREE.Group>();

  sync(list: Array<{ i: number; w: number; x: number; y: number; z: number; r: number }>, now: number) {
    const seen = new Set<number>();
    for (const d of list) {
      seen.add(d.i);
      let g = this.items.get(d.i);
      if (!g) {
        g = new THREE.Group();
        const gun = buildGun(WEAPONS[d.w] ?? WEAPONS[1], 0xffffff);
        gun.rotation.z = Math.PI / 2;
        g.add(gun);
        g.rotation.y = d.r;
        this.items.set(d.i, g);
        this.group.add(g);
      }
      g.position.set(d.x, d.y + 0.05 + Math.sin(now * 2 + d.i) * 0.01, d.z);
    }
    for (const [id, g] of this.items) {
      if (seen.has(id)) continue;
      this.group.remove(g);
      disposeGun(g);
      this.items.delete(id);
    }
  }

  clear() {
    this.sync([], 0);
  }
}
