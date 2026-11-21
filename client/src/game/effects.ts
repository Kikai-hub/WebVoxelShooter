// Трассеры (тонкая светящаяся полоска от дула до точки попадания, 0,06–0,22 с)
// и следы от пуль на стенах.

import * as THREE from 'three';

const MAX_TRACERS = 96;

export class Tracers {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private a = new Float32Array(MAX_TRACERS * 3);
  private b = new Float32Array(MAX_TRACERS * 3);
  private t = new Float32Array(MAX_TRACERS);
  private dur = new Float32Array(MAX_TRACERS);
  private rgb = new Float32Array(MAX_TRACERS * 3);
  private next = 0;
  enabled = true;
  brightness = 1;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_TRACERS * 6);
    this.col = new Float32Array(MAX_TRACERS * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false;
    this.t.fill(-1);
  }

  /** Цвет: светло-жёлтый у игроков, оранжевый у ботов. */
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, bot: boolean) {
    if (!this.enabled) return;
    const i = this.next;
    this.next = (this.next + 1) % MAX_TRACERS;
    this.a.set([ax, ay, az], i * 3);
    this.b.set([bx, by, bz], i * 3);
    const dist = Math.hypot(bx - ax, by - ay, bz - az);
    this.dur[i] = Math.min(0.22, Math.max(0.06, dist / 380));
    this.t[i] = 0;
    if (bot) this.rgb.set([1, 0.55, 0.15], i * 3);
    else this.rgb.set([1, 0.95, 0.6], i * 3);
  }

  update(dt: number) {
    for (let i = 0; i < MAX_TRACERS; i++) {
      const o = i * 6;
      if (this.t[i] < 0) {
        this.col.fill(0, o, o + 6);
        continue;
      }
      this.t[i] += dt;
      const k = this.t[i] / this.dur[i];
      if (k >= 1.25) {
        this.t[i] = -1;
        this.col.fill(0, o, o + 6);
        continue;
      }
      const ax = this.a[i * 3],
        ay = this.a[i * 3 + 1],
        az = this.a[i * 3 + 2];
      const dx = this.b[i * 3] - ax,
        dy = this.b[i * 3 + 1] - ay,
        dz = this.b[i * 3 + 2] - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      // голова полоски летит от дула к цели, хвост длиной до 4 м
      const head = Math.min(1, k);
      const tail = Math.max(0, head - 4 / len);
      this.pos[o] = ax + dx * tail;
      this.pos[o + 1] = ay + dy * tail;
      this.pos[o + 2] = az + dz * tail;
      this.pos[o + 3] = ax + dx * head;
      this.pos[o + 4] = ay + dy * head;
      this.pos[o + 5] = az + dz * head;
      const fade = (k < 1 ? 1 : 1 - (k - 1) * 4) * this.brightness;
      for (let v = 0; v < 2; v++) {
        const f = v === 0 ? fade * 0.25 : fade;
        this.col[o + v * 3] = this.rgb[i * 3] * f;
        this.col[o + v * 3 + 1] = this.rgb[i * 3 + 1] * f;
        this.col[o + v * 3 + 2] = this.rgb[i * 3 + 2] * f;
      }
    }
    const g = this.lines.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

/** Тёмные пиксельные следы от пуль на поверхностях карты. */
export class ImpactMarks {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private up = new THREE.Vector3(0, 0, 1);

  constructor(
    private max = 600,
    color = 0x241a12,
    opacity = 1,
  ) {
    const g = new THREE.PlaneGeometry(0.09, 0.09);
    // копоть — полупрозрачная, следы пуль — непрозрачные
    const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: opacity < 1 ? -1 : -2 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
  }

  private at = new Float32Array(1200 * 3).fill(-1000);

  /** Убрать следы рядом с точкой (там, где пуля выбила кусок стены). */
  removeNear(x: number, y: number, z: number, r: number) {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const o = i * 3;
      if (Math.abs(this.at[o] - x) < r && Math.abs(this.at[o + 1] - y) < r && Math.abs(this.at[o + 2] - z) < r) {
        this.mesh.setMatrixAt(i, this.zero);
        this.at[o] = -1000;
        dirty = true;
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size = 1) {
    const i = this.next;
    this.at[i * 3] = x;
    this.at[i * 3 + 1] = y;
    this.at[i * 3 + 2] = z;
    this.next = (this.next + 1) % this.max;
    this.q.setFromUnitVectors(this.up, this.v.set(nx, ny, nz));
    const sc = (0.7 + Math.random() * 0.6) * size;
    // крупные пятна (копоть) чуть дальше от поверхности, чтобы не мерцали с мелкими следами
    const off = size > 1 ? 0.006 : 0.004;
    this.m4.compose(this.v.set(x + nx * off, y + ny * off, z + nz * off), this.q, this.s.set(sc, sc, 1));
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
