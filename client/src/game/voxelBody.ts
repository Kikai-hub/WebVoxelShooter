// Воксельное тело игрока: 6 частей, каждая — InstancedMesh из вокселей 6 см.
// Раны вырезают воксели (под ними тёмное мясо), голова может разлететься,
// после смерти тело падает рэгдоллом и лежит до конца раунда.

import * as THREE from 'three';
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
  POSE_SIZE,
  POSE_STRIDE,
  SKINS,
  hash32,
} from '../../../shared/src/index';
import type { Debris } from './debris';
import { LIMB_SPLIT, Ragdoll, SEG_COUNT } from './ragdoll';

const FLESH = 0x5a0f0f;
const WOUND_RING = 0x7a0d0d;
const BLOOD = 0x9b1010;

function shade(c: number, k: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * k),
    g = Math.min(255, ((c >> 8) & 255) * k),
    b = Math.min(255, (c & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/** Цвет вокселя по стороне, варианту агента и положению. Перед — z = 0. */
function voxelColor(team: number, agent: number, part: number, x: number, y: number, z: number): number {
  const [nx, ny, nz] = PART_DIMS[part];
  const h = hash32(part * 100003 + x * 7919 + y * 104729 + z * 1299709);
  const n = 0.9 + (h % 100) / 500;
  const camo = (a: number, b: number, c: number) => {
    const v = hash32(Math.floor(x / 2) * 31 + Math.floor(y / 2) * 131 + Math.floor(z / 2) * 17 + part * 7) % 3;
    return v === 0 ? a : v === 1 ? b : c;
  };
  const front = z === 0;
  if (team === 0) {
    // Нападение: коричневая балаклава, куфия, бежевые рукава, оливковый жилет и камуфляж
    const kufA = agent ? 0x2f6b3a : 0x8a2a2a;
    if (part === PART_HEAD) {
      if (y === 0) return (x + z) % 2 ? kufA : 0xd8d0c0;
      if (front && y === 3 && x >= 1 && x <= 4) return x === 1 || x === 4 ? 0x1a1410 : 0xc89a6a;
      if (front && y === 4 && x >= 1 && x <= 4) return 0x3a2414;
      return shade(agent ? 0x5a4a3a : 0x6b4a2f, n);
    }
    if (part === PART_TORSO) {
      if (y === ny - 1) return (x + z) % 2 ? kufA : 0xd8d0c0;
      if (x === 0 || x === nx - 1) return shade(0xc2a77a, n);
      if (front && y >= 3 && y <= 6 && (x === 1 || x === 2 || x === 5 || x === 6)) return shade(0x464d26, n);
      if (y === 1) return shade(0x4a3a22, n);
      return shade(0x5a6332, n);
    }
    if (part === PART_ARM_L || part === PART_ARM_R) {
      if (y <= 1) return shade(0x3a3a30, n);
      return shade(0xc2a77a, n);
    }
    if (y <= 1) return shade(0x3b2b1e, n);
    if (y === 6 && front) return shade(0x3d3a2a, n);
    return shade(camo(0x6b7040, 0x4f5530, 0x7d7f4f), n);
  }
  // Защита: чёрный шлем, синие очки, чёрная балаклава, синий камуфляж, чёрный жилет
  const camoA = agent ? 0x5a6068 : 0x2f4f7f;
  const camoB = agent ? 0x3f454c : 0x223a5e;
  const camoC = agent ? 0x737a82 : 0x41689c;
  if (part === PART_HEAD) {
    if (y >= 4) return shade(0x15161a, n);
    if (front && y === 3 && x >= 1 && x <= 4) return x === 2 || x === 3 ? 0x6fb2ff : 0x3b7bd8;
    return shade(0x1e1f22, n);
  }
  if (part === PART_TORSO) {
    if (x === 0 || x === nx - 1) return shade(camo(camoA, camoB, camoC), n);
    if (front && y >= 7 && y <= 9 && x === 5) return y === 9 ? 0xf2f2f2 : y === 8 ? 0x2d5bd0 : 0xc8282d;
    if (y <= 1) return shade(0x1b1c1f, n);
    return shade(0x23252a, n);
  }
  if (part === PART_ARM_L || part === PART_ARM_R) {
    if (y <= 1) return shade(0x141518, n);
    return shade(camo(camoA, camoB, camoC), n);
  }
  if (y <= 1) return shade(0x141416, n);
  if (y === 6 && front) return shade(0x1b1c1f, n);
  return shade(camo(camoA, camoB, camoC), n);
}

const GUN_COLORS: Record<string, number> = { pistol: 0x2b2b2e, smg: 0x333236, shotgun: 0x5a3b22, rifle: 0x3a3430, sniper: 0x3c4436, knife: 0x9aa0a6 };

interface PartMesh {
  mesh: InstancedMesh;
  nx: number;
  ny: number;
  nz: number;
  alive: Uint8Array;
  shown: Uint8Array;
  colors: Uint32Array;
  /** для рук и ног: воксели ниже split (предплечье, голень) поворачиваются вокруг сустава */
  split: number;
  bend: THREE.Matrix4 | null;
}
type InstancedMesh = THREE.InstancedMesh;

const sharedGeo = new THREE.BoxGeometry(BVOX, BVOX, BVOX);

export class VoxelBody {
  readonly group = new THREE.Group();
  readonly parts: PartMesh[] = [];
  private gun: THREE.Mesh;
  private gunKind = '';
  private m4 = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private col = new THREE.Color();
  private rot = new THREE.Matrix4();
  pose = new Float32Array(POSE_SIZE);
  ragdoll: Ragdoll | null = null;
  headGone = false;
  woundCount = 0;

  constructor(
    readonly team: number,
    readonly agent: number,
    private skin: number,
    material: THREE.Material,
  ) {
    for (let p = 0; p < PART_COUNT; p++) {
      const [nx, ny, nz] = PART_DIMS[p];
      const count = nx * ny * nz;
      const mesh = new THREE.InstancedMesh(sharedGeo, material, count);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      const pm: PartMesh = { mesh, nx, ny, nz, alive: new Uint8Array(count).fill(1), shown: new Uint8Array(count), colors: new Uint32Array(count), split: LIMB_SPLIT[p] ?? 0, bend: null };
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            const i = x + nx * (y + ny * z);
            const boundary = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
            pm.colors[i] = boundary ? voxelColor(team, agent, p, x, y, z) : FLESH;
            this.m4.makeTranslation((x + 0.5) * BVOX - (nx * BVOX) / 2, (y + 0.5) * BVOX - (ny * BVOX) / 2, (z + 0.5) * BVOX - (nz * BVOX) / 2);
            mesh.setColorAt(i, this.col.set(pm.colors[i]));
            if (boundary) {
              mesh.setMatrixAt(i, this.m4);
              pm.shown[i] = 1;
            } else mesh.setMatrixAt(i, this.zero);
          }
      this.parts.push(pm);
      this.group.add(mesh);
    }
    // оружие в руках (третье лицо) — дочерний объект правой руки
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    this.gun.position.set(-0.05, -0.36, -0.12);
    this.gun.rotation.x = -1.25;
    this.parts[PART_ARM_R].mesh.add(this.gun);
  }

  setWeapon(kind: string) {
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    this.gun.visible = kind !== 'none';
    const len = kind === 'pistol' ? 0.2 : kind === 'knife' ? 0.18 : kind === 'grenade' ? 0.1 : kind === 'sniper' ? 0.75 : kind === 'smg' ? 0.38 : 0.55;
    this.gun.scale.set(1, 1, len / 0.5);
    this.gun.position.set(-0.05 + (kind === 'pistol' || kind === 'knife' ? 0.02 : -0.02), -0.36, -0.12 - (len - 0.5) * 0.4);
    const tint = SKINS[this.skin]?.tint ?? 0xffffff;
    (this.gun.material as THREE.MeshLambertMaterial).color.set(GUN_COLORS[kind] ?? 0x333333).multiply(new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4));
  }

  private poseMatrix(pose: Float32Array, i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const o = i * POSE_STRIDE;
    out.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o], pose[o + 6], pose[o + 7], pose[o + 8], pose[o + 1], pose[o + 9], pose[o + 10], pose[o + 11], pose[o + 2], 0, 0, 0, 1);
    const sy = pose[o + 12];
    if (sy !== 1) out.multiply(this.m4.makeScale(1, sy, 1));
    return out;
  }

  /** Матрица вокселя внутри части (с учётом сгиба в суставе). */
  private voxelMatrix(pm: PartMesh, x: number, y: number, z: number, out: THREE.Matrix4): THREE.Matrix4 {
    out.makeTranslation((x + 0.5) * BVOX - (pm.nx * BVOX) / 2, (y + 0.5) * BVOX - (pm.ny * BVOX) / 2, (z + 0.5) * BVOX - (pm.nz * BVOX) / 2);
    if (pm.bend && y < pm.split) out.premultiply(pm.bend);
    return out;
  }

  /** Применить позу живого игрока (6 частей, конечности прямые). */
  applyPose(pose: Float32Array) {
    for (let p = 0; p < PART_COUNT; p++) {
      const pm = this.parts[p];
      this.poseMatrix(pose, p, pm.mesh.matrix);
      pm.mesh.matrixWorldNeedsUpdate = true;
      if (pm.bend) this.setBend(pm, null);
    }
  }

  private inv = new THREE.Matrix4();
  private lower = new THREE.Matrix4();

  /** Применить сегменты рэгдолла: голова, торс и по два звена на каждую конечность. */
  applySegments(seg: Float32Array) {
    this.poseMatrix(seg, 0, this.parts[PART_HEAD].mesh.matrix);
    this.poseMatrix(seg, 1, this.parts[PART_TORSO].mesh.matrix);
    this.parts[PART_HEAD].mesh.matrixWorldNeedsUpdate = true;
    this.parts[PART_TORSO].mesh.matrixWorldNeedsUpdate = true;
    let s = 2;
    for (const p of [PART_ARM_L, PART_ARM_R, PART_LEG_L, PART_LEG_R]) {
      const pm = this.parts[p];
      this.poseMatrix(seg, s++, pm.mesh.matrix);
      pm.mesh.matrixWorldNeedsUpdate = true;
      // сгиб = верх⁻¹ · низ: в системе части нижнее звено повёрнуто вокруг сустава
      this.poseMatrix(seg, s++, this.lower);
      this.inv.copy(pm.mesh.matrix).invert();
      this.setBend(pm, this.inv.multiply(this.lower));
    }
  }

  private setBend(pm: PartMesh, bend: THREE.Matrix4 | null) {
    if (bend) {
      pm.bend ??= new THREE.Matrix4();
      pm.bend.copy(bend);
    } else pm.bend = null;
    for (let z = 0; z < pm.nz; z++)
      for (let y = 0; y < pm.split; y++)
        for (let x = 0; x < pm.nx; x++) {
          const i = x + pm.nx * (y + pm.ny * z);
          if (pm.shown[i] && pm.alive[i]) pm.mesh.setMatrixAt(i, this.voxelMatrix(pm, x, y, z, this.m4));
        }
    pm.mesh.instanceMatrix.needsUpdate = true;
  }

  private localToWorld(part: number, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const pm = this.parts[part];
    out.set((x + 0.5) * BVOX - (pm.nx * BVOX) / 2, (y + 0.5) * BVOX - (pm.ny * BVOX) / 2, (z + 0.5) * BVOX - (pm.nz * BVOX) / 2);
    if (pm.bend && y < pm.split) out.applyMatrix4(pm.bend);
    return out.applyMatrix4(pm.mesh.matrix);
  }

  private reveal(pm: PartMesh, i: number, x: number, y: number, z: number) {
    if (!pm.alive[i] || pm.shown[i]) return;
    pm.shown[i] = 1;
    pm.mesh.setMatrixAt(i, this.voxelMatrix(pm, x, y, z, this.m4));
  }

  /** Сегменты для рэгдолла (10 штук). */
  readonly seg = new Float32Array(SEG_COUNT * POSE_STRIDE);

  /** Рана: вырезает воксели в радиусе, открывает мясо, окрашивает край, брызги крови. */
  wound(part: number, cx: number, cy: number, cz: number, r: number, exit: boolean, debris: Debris | null, bloodMode: string) {
    const pm = this.parts[part];
    if (!pm || (part === PART_HEAD && this.headGone)) return;
    this.woundCount++;
    const R = r + 0.35;
    const ring = R + 1.2;
    const v = new THREE.Vector3();
    const confetti = bloodMode === 'confetti';
    for (let z = Math.max(0, Math.floor(cz - ring)); z <= Math.min(pm.nz - 1, Math.ceil(cz + ring)); z++)
      for (let y = Math.max(0, Math.floor(cy - ring)); y <= Math.min(pm.ny - 1, Math.ceil(cy + ring)); y++)
        for (let x = Math.max(0, Math.floor(cx - ring)); x <= Math.min(pm.nx - 1, Math.ceil(cx + ring)); x++) {
          const d = Math.hypot(x - cx, y - cy, z - cz);
          const i = x + pm.nx * (y + pm.ny * z);
          if (d <= R && pm.alive[i]) {
            pm.alive[i] = 0;
            pm.shown[i] = 0;
            pm.mesh.setMatrixAt(i, this.zero);
            // соседей внутри — показать (тёмное мясо)
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
              const xx = x + dx,
                yy = y + dy,
                zz = z + dz;
              if (xx < 0 || yy < 0 || zz < 0 || xx >= pm.nx || yy >= pm.ny || zz >= pm.nz) continue;
              const j = xx + pm.nx * (yy + pm.ny * zz);
              if (pm.colors[j] !== FLESH || pm.shown[j]) {
                if (!pm.shown[j]) this.reveal(pm, j, xx, yy, zz);
                continue;
              }
              this.reveal(pm, j, xx, yy, zz);
            }
            if (debris && Math.random() < 0.7) {
              this.localToWorld(part, x, y, z, v);
              const c = confetti ? [0xff4fa0, 0x4fd2ff, 0xffe14f, 0x7dff4f][(Math.random() * 4) | 0] : Math.random() < 0.5 ? BLOOD : pm.colors[i];
              debris.spawn(v.x, v.y, v.z, (Math.random() - 0.5) * 2.5, Math.random() * 2.5 + (exit ? 1 : 0.3), (Math.random() - 0.5) * 2.5, c, -1);
            }
          } else if (d <= ring && pm.alive[i] && pm.shown[i] && !confetti) {
            // тёмный край раны
            const c = d <= R + 0.7 ? WOUND_RING : shade(pm.colors[i], 0.55) | 0;
            const mix = d <= R + 0.7 ? WOUND_RING : (((((pm.colors[i] >> 16) & 255) + 0x8a) >> 1) << 16) | ((((pm.colors[i] >> 8) & 255) * 0.4) << 8) | ((pm.colors[i] & 255) * 0.4);
            pm.mesh.setColorAt(i, this.col.set(Math.random() < 0.6 ? c : mix));
          }
        }
    pm.mesh.instanceMatrix.needsUpdate = true;
    if (pm.mesh.instanceColor) pm.mesh.instanceColor.needsUpdate = true;
  }

  /** Разлёт головы на кубики. */
  explodeHead(debris: Debris, dir: [number, number, number], bloodMode: string) {
    if (this.headGone) return;
    this.headGone = true;
    const pm = this.parts[PART_HEAD];
    const v = new THREE.Vector3();
    const confetti = bloodMode === 'confetti';
    for (let z = 0; z < pm.nz; z++)
      for (let y = 0; y < pm.ny; y++)
        for (let x = 0; x < pm.nx; x++) {
          const i = x + pm.nx * (y + pm.ny * z);
          if (!pm.alive[i]) continue;
          pm.alive[i] = 0;
          this.localToWorld(PART_HEAD, x, y, z, v);
          const sp = 2 + Math.random() * 4;
          const c = confetti ? [0xff4fa0, 0x4fd2ff, 0xffe14f, 0x7dff4f][(Math.random() * 4) | 0] : pm.colors[i] === FLESH ? (Math.random() < 0.5 ? BLOOD : FLESH) : pm.colors[i];
          debris.spawn(v.x, v.y, v.z, dir[0] * sp + (Math.random() - 0.5) * 4, dir[1] * sp + Math.random() * 3.5, dir[2] * sp + (Math.random() - 0.5) * 4, c, -1);
          pm.mesh.setMatrixAt(i, this.zero);
        }
    // дополнительные брызги крови
    for (let k = 0; k < 40; k++) {
      this.localToWorld(PART_HEAD, 3, 0, 3, v);
      debris.spawn(v.x, v.y, v.z, dir[0] * 3 + (Math.random() - 0.5) * 5, Math.random() * 4, dir[2] * 3 + (Math.random() - 0.5) * 5, confetti ? 0xffe14f : BLOOD, -1);
    }
    pm.mesh.instanceMatrix.needsUpdate = true;
    // открыть шею
    const torso = this.parts[PART_TORSO];
    for (let z = 1; z < torso.nz - 1; z++)
      for (let x = 2; x < torso.nx - 2; x++) {
        const i = x + torso.nx * (torso.ny - 1 + torso.ny * z);
        torso.mesh.setColorAt(i, this.col.set(WOUND_RING));
      }
    if (torso.mesh.instanceColor) torso.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    for (const p of this.parts) p.mesh.dispose();
    this.gun.geometry.dispose();
  }
}

export { BLOOD, PART_LEG_L, PART_LEG_R };
