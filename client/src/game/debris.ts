// Летящие кубики: осколки головы, брызги крови, пыль и сколы от пуль.
// Один InstancedMesh, движение в типизированных массивах без аллокаций.

import * as THREE from 'three';
import { BVOX, VoxelMap, VOXEL } from '../../../shared/src/index';

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private rest: Uint8Array;
  private spin: Float32Array;
  private next = 0;
  /** сколько частиц выпущено недавно (затухает за ~0,5 с) — мерило нагрузки для разлёта тел */
  private recent = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private col = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  quality = 1;

  constructor(
    public map: VoxelMap,
    max = 2000,
  ) {
    this.n = max;
    const geo = new THREE.BoxGeometry(BVOX, BVOX, BVOX);
    const mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.col.set(0xffffff));
    }
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rest = new Uint8Array(max);
    this.spin = new Float32Array(max);
  }

  /** life < 0 — кубик остаётся лежать до конца раунда (пока его не вытеснят новые). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = -1, size = 1) {
    this.recent++;
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.size[i] = size;
    this.rest[i] = 0;
    this.spin[i] = Math.random() * 6;
    this.mesh.setColorAt(i, this.col.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Нагрузка 0..1+: доля буфера, выпущенная за последние ~0,5 с. Разлёт тел при высокой нагрузке
   * берёт куски крупнее, чтобы несколько одновременных разрывов (бомба) не вытеснили всё и не роняли FPS.
   */
  load(): number {
    return this.recent / this.n;
  }

  clear() {
    for (let i = 0; i < this.n; i++) {
      this.life[i] = 0;
      this.rest[i] = 1;
      this.mesh.setMatrixAt(i, this.zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    this.recent *= Math.exp(-dt * 4);
    const map = this.map;
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      if (this.rest[i] === 2) continue;
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.rest[i] = 2;
          this.mesh.setMatrixAt(i, this.zero);
          dirty = true;
          continue;
        }
      } else if (this.life[i] === 0) continue;
      if (this.rest[i] === 1) continue;
      this.vy[i] -= 18 * dt;
      const nx = this.px[i] + this.vx[i] * dt;
      const ny = this.py[i] + this.vy[i] * dt;
      const nz = this.pz[i] + this.vz[i] * dt;
      if (map.solidAt(nx, ny, nz)) {
        // отскок с потерей энергии
        if (!map.solidAt(nx, this.py[i], this.pz[i])) {
          this.vy[i] *= -0.25;
          this.vx[i] *= 0.6;
          this.vz[i] *= 0.6;
          if (this.vy[i] < 0.6) {
            this.vy[i] = 0;
            this.py[i] = (Math.floor(ny / VOXEL) + 1) * VOXEL + BVOX * 0.5 * this.size[i];
          }
        } else {
          // удар о стену: отскок по горизонтали, но падение продолжается (иначе кусок «прилипает» к стене)
          this.vx[i] *= -0.3;
          this.vz[i] *= -0.3;
          if (!map.solidAt(this.px[i], ny, this.pz[i])) this.py[i] = ny;
        }
        // засыпает только с опорой снизу, а не в воздухе у стены
        if (Math.abs(this.vx[i]) + Math.abs(this.vy[i]) + Math.abs(this.vz[i]) < 0.4 && map.solidAt(this.px[i], this.py[i] - BVOX * this.size[i], this.pz[i])) {
          this.rest[i] = 1;
          this.spin[i] = Math.round(this.spin[i] / (Math.PI / 2)) * (Math.PI / 2);
        }
      } else {
        this.px[i] = nx;
        this.py[i] = ny;
        this.pz[i] = nz;
        this.spin[i] += dt * 8;
      }
      const s = this.size[i];
      this.e.set(this.spin[i], this.spin[i] * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v3.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s3.set(s, this.rest[i] ? s * 0.6 : s, s));
      this.mesh.setMatrixAt(i, this.m4);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
