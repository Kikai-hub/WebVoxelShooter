// Воксельное тело игрока: 6 частей, каждая — InstancedMesh из вокселей 6 см.
// Раны вырезают воксели (под ними тёмное мясо), голова или любая часть может разлететься
// (пуля в голову, граната, бомба), после смерти тело падает рэгдоллом и лежит до конца раунда.

import * as THREE from 'three';
import {
  BVOX,
  GIB_HEAD,
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
  type PoseAnim,
} from '../../../shared/src/index';
import type { Debris } from './debris';
import { LIMB_SPLIT, Ragdoll, SEG_COUNT } from './ragdoll';
import { cloneGun, gunModel } from './weaponModels';
import { disposeKnife, KNIFE_OF_TEAM, makeKnife } from './knifeModels';

const FLESH = 0x5a0f0f;
const WOUND_RING = 0x7a0d0d;
const BLOOD = 0x9b1010;
const CONFETTI = [0xff4fa0, 0x4fd2ff, 0xffe14f, 0x7dff4f];
const confettiColor = () => CONFETTI[(Math.random() * 4) | 0];

type V3 = [number, number, number];

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

const GUN_COLORS: Record<string, number> = { bomb: 0x4a4f3a, pistol: 0x2b2b2e, smg: 0x333236, shotgun: 0x5a3b22, rifle: 0x3a3430, sniper: 0x3c4436, knife: 0x9aa0a6 };

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
  /** оторванные части (1 — разлетелась) */
  readonly gone = new Uint8Array(PART_COUNT);
  get headGone(): boolean {
    return this.gone[PART_HEAD] === 1;
  }
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
    // оружие в руках (третье лицо): своё положение — точка хвата правой руки, ствол вдоль −Z
    this.gunHolder.matrixAutoUpdate = false;
    this.group.add(this.gunHolder);
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    this.gunHolder.add(this.gun);
  }

  private gunHolder = new THREE.Object3D();
  private gunModel: THREE.Group | null = null;

  /** Оружие в руках: модель из пака по ключу (vikhr, osa…), если загружена, иначе коробка по виду. */
  setWeapon(kind: string, key = '') {
    const model = key && kind !== 'none' ? gunModel(key) : null;
    const state = model ? 'm:' + key : kind === 'knife' ? 'k:' + this.team : 'b:' + kind;
    if (state === this.gunKind) return;
    this.gunKind = state;
    if (this.gunModel) {
      this.gunHolder.remove(this.gunModel);
      if (this.gunModel.userData.knife) disposeKnife(this.gunModel);
      this.gunModel = null;
    }
    if (kind === 'knife') {
      // нож стороны: керамбит у нападения, штык-нож у защиты
      this.gunModel = makeKnife(KNIFE_OF_TEAM[this.team === 0 ? 0 : 1], SKINS[this.skin]?.tint ?? 0xffffff, true);
      this.gunModel.userData.knife = true;
      this.gunHolder.add(this.gunModel);
      this.gun.visible = false;
      return;
    }
    if (model) {
      this.gunModel = cloneGun(key, SKINS[this.skin]?.tint ?? 0xffffff);
      if (this.gunModel) this.gunHolder.add(this.gunModel);
      this.gun.visible = false;
      return;
    }
    this.gun.visible = kind !== 'none';
    const len = kind === 'bomb' ? 0.3 : kind === 'pistol' ? 0.2 : kind === 'knife' ? 0.18 : kind === 'grenade' ? 0.1 : kind === 'sniper' ? 0.8 : kind === 'smg' ? 0.4 : kind === 'shotgun' ? 0.62 : 0.6;
    // сколько оружия позади кисти: приклад упирается в плечо, у пистолета почти ничего
    const behind = kind === 'bomb' ? 0.15 : kind === 'pistol' ? 0.04 : kind === 'knife' || kind === 'grenade' ? 0 : kind === 'smg' ? 0.14 : kind === 'sniper' ? 0.22 : 0.18;
    const thick = kind === 'bomb' ? 1.4 : kind === 'pistol' ? 0.6 : kind === 'knife' ? 0.35 : kind === 'grenade' ? 1 : 1;
    this.gun.scale.set(kind === 'bomb' ? 2.6 : kind === 'knife' ? 0.3 : kind === 'grenade' ? 1.1 : 0.85, thick, len / 0.5);
    // центр коробки: вперёд от кисти на len/2 − behind, чуть выше кисти (рукоять под стволом)
    this.gun.position.set(0, kind === 'grenade' ? 0 : 0.045, -(len / 2 - behind));
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

  /** Текущий сгиб суставов живой позы (локти, колени), чтобы не пересчитывать воксели без нужды. */
  private jointAngle = new Map<number, number>();
  private jointM = new THREE.Matrix4();
  private jointR = new THREE.Matrix4();
  private gunFallback = new THREE.Matrix4();

  /**
   * Применить позу. Без anim — поза хитбоксов: конечности прямые, оружие в правой руке.
   * С anim — живая поза: колени и локти согнуты, оружие в точке хвата (только картинка).
   */
  applyPose(pose: Float32Array, anim?: PoseAnim) {
    for (let p = 0; p < PART_COUNT; p++) {
      const pm = this.parts[p];
      this.poseMatrix(pose, p, pm.mesh.matrix);
      pm.mesh.matrixWorldNeedsUpdate = true;
    }
    this.setJoint(PART_LEG_L, anim ? -anim.kneeL : 0);
    this.setJoint(PART_LEG_R, anim ? -anim.kneeR : 0);
    this.setJoint(PART_ARM_L, anim ? anim.elbowL : 0);
    this.setJoint(PART_ARM_R, anim ? anim.elbowR : 0);
    if (anim) this.poseMatrix(anim.gun, 0, this.gunHolder.matrix);
    else {
      // как раньше: оружие продолжает прямую правую руку
      this.gunHolder.matrix.copy(this.parts[PART_ARM_R].mesh.matrix);
      this.gunHolder.matrix.multiply(this.gunFallback.makeTranslation(-0.03, -0.33, -0.02));
      this.gunHolder.matrix.multiply(this.gunFallback.makeRotationX(-1.25));
    }
    this.gunHolder.matrixWorldNeedsUpdate = true;
  }

  /** Сгиб в суставе: нижние воксели (предплечье, голень) поворачиваются вокруг оси X части. */
  private setJoint(part: number, angle: number) {
    const pm = this.parts[part];
    if (Math.abs(angle) < 0.01) angle = 0;
    const prev = this.jointAngle.get(part) ?? 0;
    // ниже порога глаз разницы не видит, а пересчёт сотни вокселей не бесплатный
    if (Math.abs(angle - prev) < 0.015 && (angle === 0) === !pm.bend) return;
    this.jointAngle.set(part, angle);
    if (angle === 0) {
      if (pm.bend) this.setBend(pm, null);
      return;
    }
    const jy = -(pm.ny * BVOX) / 2 + pm.split * BVOX;
    this.jointM.makeTranslation(0, jy, 0);
    this.jointM.multiply(this.jointR.makeRotationX(angle));
    this.jointM.multiply(this.jointR.makeTranslation(0, -jy, 0));
    this.setBend(pm, this.jointM);
  }

  private inv = new THREE.Matrix4();
  private lower = new THREE.Matrix4();

  /** Применить сегменты рэгдолла: голова, торс и по два звена на каждую конечность. */
  applySegments(seg: Float32Array) {
    for (const p of [PART_ARM_L, PART_ARM_R, PART_LEG_L, PART_LEG_R]) this.jointAngle.set(p, NaN); // сгибы теперь задаёт рэгдолл
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
              const c = confetti ? confettiColor() : Math.random() < 0.5 ? BLOOD : pm.colors[i];
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

  /** Разлёт головы на кубики (пуля в голову): каждый воксель — отдельный кубик, как раньше. */
  explodeHead(debris: Debris, dir: V3, bloodMode: string) {
    this.explodePart(PART_HEAD, debris, dir, 4, bloodMode, null, 1, 40);
  }

  /**
   * Разлёт части тела кусками: воксели собираются в кубы chunk×chunk×chunk (2 — до 8 вокселей в куске),
   * каждый кусок — одна частица Debris. Направление — от центра взрыва from (если есть), иначе dir;
   * force — скорость разлёта, м/с. При загруженном Debris куски автоматически крупнее.
   * На месте отрыва у оставшегося тела — открытая рана, звенья рэгдолла отцепляются.
   */
  explodePart(part: number, debris: Debris, dir: V3, force: number, bloodMode: string, from: V3 | null = null, chunk = 2, blood = 10) {
    if (this.gone[part]) return;
    this.gone[part] = 1;
    const pm = this.parts[part];
    const confetti = bloodMode === 'confetti';
    // под нагрузкой (много свежих частиц) — куски крупнее: 3³ вместо 2³ вокселей — втрое меньше частиц
    const load = debris.load();
    const c = load > 0.6 ? chunk + 2 : load > 0.3 ? chunk + 1 : chunk;
    const v = this.tmpV;
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    for (let bz = 0; bz < pm.nz; bz += c)
      for (let by = 0; by < pm.ny; by += c)
        for (let bx = 0; bx < pm.nx; bx += c) {
          let n = 0,
            sx = 0,
            sy = 0,
            sz = 0,
            col = -1;
          for (let z = bz; z < Math.min(pm.nz, bz + c); z++)
            for (let y = by; y < Math.min(pm.ny, by + c); y++)
              for (let x = bx; x < Math.min(pm.nx, bx + c); x++) {
                const i = x + pm.nx * (y + pm.ny * z);
                if (!pm.alive[i]) continue;
                // цвет куска — с поверхности (одежда, кожа), если она в куске есть
                if (pm.shown[i] && (col < 0 || col === FLESH)) col = pm.colors[i];
                pm.alive[i] = 0;
                pm.shown[i] = 0;
                pm.mesh.setMatrixAt(i, this.zero);
                this.localToWorld(part, x, y, z, v);
                sx += v.x;
                sy += v.y;
                sz += v.z;
                n++;
              }
          if (!n) continue;
          const px = sx / n,
            py = sy / n,
            pz = sz / n;
          let ux: number, uy: number, uz: number;
          if (from) {
            ux = px - from[0];
            uy = py - from[1];
            uz = pz - from[2];
            const l = Math.hypot(ux, uy, uz) || 1;
            ux /= l;
            uy = (uy / l) * 0.6 + 0.55; // взрыв подбрасывает вверх
            uz /= l;
          } else {
            ux = dir[0] / dl;
            uy = dir[1] / dl;
            uz = dir[2] / dl;
          }
          const sp = force * (0.55 + Math.random() * 0.75);
          const jit = force * 0.9;
          const color = confetti ? confettiColor() : col < 0 || col === FLESH ? (Math.random() < 0.5 ? BLOOD : FLESH) : Math.random() < 0.15 ? BLOOD : col;
          // размер куска по числу вокселей в нём (неполный кусок — меньше)
          const size = Math.max(1, c * Math.cbrt(n / (c * c * c)));
          debris.spawn(px, py, pz, ux * sp + (Math.random() - 0.5) * jit, uy * sp + Math.random() * force * 0.7, uz * sp + (Math.random() - 0.5) * jit, color, -1, size);
        }
    pm.mesh.instanceMatrix.needsUpdate = true;
    // брызги крови из места отрыва
    const nb = load > 0.5 ? blood >> 2 : blood;
    this.localToWorld(part, (pm.nx - 1) / 2, part === PART_HEAD ? 0 : (pm.ny - 1) / 2, (pm.nz - 1) / 2, v);
    const bx = from ? v.x - from[0] : dir[0],
      bz = from ? v.z - from[2] : dir[2];
    const bl = Math.hypot(bx, bz) || 1;
    for (let k = 0; k < nb; k++) {
      const s2 = Math.min(force, 6) * (0.4 + Math.random() * 0.6);
      debris.spawn(v.x, v.y, v.z, (bx / bl) * s2 + (Math.random() - 0.5) * 5, Math.random() * 4, (bz / bl) * s2 + (Math.random() - 0.5) * 5, confetti ? confettiColor() : BLOOD, -1);
    }
    this.openStump(part, confetti);
    this.ragdoll?.detach(part);
  }

  /**
   * Разрыв тела по событию убийства: level — GIB_* (1 — голова от пули, 2 — части из mask, 3 — все части),
   * from — центр взрыва, force — скорость разлёта. Для трупа у опоздавших force маленькая: куски просто ложатся.
   */
  gib(level: number, mask: number, debris: Debris, dir: V3, from: V3 | null, force: number, bloodMode: string) {
    if (level === GIB_HEAD) {
      if (force >= 2) this.explodeHead(debris, dir, bloodMode);
      else this.explodePart(PART_HEAD, debris, dir, force, bloodMode, null, 2, 4);
      return;
    }
    // сначала голова и конечности, торс последним
    for (const p of [PART_HEAD, PART_ARM_L, PART_ARM_R, PART_LEG_L, PART_LEG_R, PART_TORSO])
      if (mask & (1 << p)) this.explodePart(p, debris, dir, force, bloodMode, from, 2, force >= 2 ? (p === PART_TORSO ? 16 : 8) : 2);
  }

  /** Открытая рана у оставшегося тела на месте оторванной части (как шея при разлёте головы). */
  private openStump(part: number, confetti: boolean) {
    if (part === PART_TORSO || this.gone[PART_TORSO]) return;
    const torso = this.parts[PART_TORSO];
    const mark = (x: number, y: number, z: number) => {
      const i = x + torso.nx * (y + torso.ny * z);
      if (!torso.alive[i]) return;
      torso.mesh.setColorAt(i, this.col.set(confetti ? confettiColor() : Math.random() < 0.7 ? WOUND_RING : FLESH));
    };
    const top = torso.ny - 1;
    if (part === PART_HEAD) {
      for (let z = 1; z < torso.nz - 1; z++) for (let x = 2; x < torso.nx - 2; x++) mark(x, top, z);
    } else if (part === PART_ARM_L || part === PART_ARM_R) {
      // плечо: боковая грань торса у верха и край верхней грани
      const x = part === PART_ARM_L ? 0 : torso.nx - 1;
      for (let y = top - 3; y <= top; y++) for (let z = 0; z < torso.nz; z++) mark(x, y, z);
      for (let z = 0; z < torso.nz; z++) mark(part === PART_ARM_L ? 1 : torso.nx - 2, top, z);
    } else {
      // бедро: низ торса над ногой
      const x0 = part === PART_LEG_L ? 0 : torso.nx / 2;
      for (let x = x0; x < x0 + torso.nx / 2; x++) for (let z = 0; z < torso.nz; z++) mark(x, 0, z);
    }
    if (torso.mesh.instanceColor) torso.mesh.instanceColor.needsUpdate = true;
  }

  private tmpV = new THREE.Vector3();

  dispose() {
    this.group.removeFromParent();
    for (const p of this.parts) p.mesh.dispose();
    this.gun.geometry.dispose();
  }
}

export { BLOOD, PART_LEG_L, PART_LEG_R };
