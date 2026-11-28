// Оружие и руки от первого лица: блочные модели с пиксельными цветами,
// покачивание при ходьбе, отдача, вспышка выстрела. Доставание, перезарядка, удары ножом
// и осмотр — по ключевым кадрам (vmAnims.ts): поза рук с оружием, левая кисть, магазин.

import * as THREE from 'three';
import { DRAW_TIME, SKINS, WEAPONS, type WeaponDef } from '../../../shared/src/index';
import { cloneGun, gunModel, onGunModel } from './weaponModels';
import { KNIFE_OF_TEAM, makeKnife } from './knifeModels';
import { clearVmPose, drawTrack, inspectOf, type KnifeAnimKind, KNIFE_REST_P, KNIFE_REST_R, newVmPose, reloadTrack, SWING_DUR, SWING_LR, SWING_RL, type VmTrack } from './vmAnims';

/** где правая перчатка держит рукоять (система root) и масштаб моделей от первого лица */
const VM_GRIP = new THREE.Vector3(0.0, -0.025, -0.01);
const VM_SCALE = 0.85;
/** где кисть держит нож (система рук): у защиты штык-нож, у нападения керамбит */
const VM_KNIFE_CT = new THREE.Vector3(0.0, 0.0, -0.06);
const VM_KNIFE_T = new THREE.Vector3(0.0, 0.0, -0.06);
/** длина левого рукава (коробка вдоль Z) */
const SLEEVE_L_LEN = 0.38;
/** положение рук в камере без анимации */
const ROOT0 = new THREE.Vector3(0.22, -0.24, -0.42);
/** левая рука у одноручного оружия (пистолет) — за нижним краем экрана, отсюда она тянется к магазину */
const LEFT_OFF = new THREE.Vector3(-0.12, -0.3, 0.06);
const SHOULDER_OFF = new THREE.Vector3(-0.32, -0.34, 0.22);

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

/** Оружие: модель из пака, если загружена, иначе блочное. Начало — точка хвата, дуло вдоль −Z. */
/** team — сторона: от неё зависит нож (0 — керамбит, 1 — штык-нож). */
export function buildGun(def: WeaponDef, tint: number, team = 1, inHand = false): THREE.Group {
  if (def.kind === 'knife') return makeKnife(KNIFE_OF_TEAM[team === 0 ? 0 : 1], tint, inHand);
  const model = cloneGun(def.key, tint);
  if (model) return model;
  const g = new THREE.Group();
  const t = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.35);
  const metal = new THREE.Color(0x5a5d66).multiply(t).getHex();
  const metal2 = new THREE.Color(0x7a7e88).multiply(t).getHex();
  const wood = new THREE.Color(0x7a5230).multiply(t).getHex();
  switch (def.kind) {
    case 'grenade': {
      if (def.key === 'molotov') {
        // бутылка: тёмное стекло, горлышко и горящая тряпка
        g.add(box(0.075, 0.14, 0.075, 0x4a6a2a, 0, 0.03, -0.04));
        g.add(box(0.035, 0.07, 0.035, 0x3e5a24, 0, 0.13, -0.04));
        g.add(box(0.045, 0.05, 0.045, 0xd8c8a0, 0, 0.18, -0.04));
        const flame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xffa02a, toneMapped: false }));
        flame.position.set(0, 0.24, -0.04);
        g.add(flame);
        break;
      }
      if (def.key === 'incgrenade') {
        // зажигательная граната: серый цилиндр с красной полосой
        g.add(box(0.07, 0.12, 0.07, 0x7a7d80, 0, 0.03, -0.04));
        g.add(box(0.072, 0.02, 0.072, 0xc0352a, 0, 0.05, -0.04));
        g.add(box(0.04, 0.03, 0.04, 0x555555, 0, 0.105, -0.04));
        break;
      }
      const body = def.key === 'he' ? 0x4f6b32 : def.key === 'flash' ? 0x9aa0a6 : 0xd9d9d4;
      g.add(box(0.07, 0.1, 0.07, body, 0, 0.02, -0.04));
      g.add(box(0.04, 0.03, 0.04, 0x555555, 0, 0.085, -0.04));
      g.add(box(0.015, 0.015, 0.05, 0xc9a23a, 0.025, 0.09, -0.02));
      break;
    }
    case 'pistol':
      g.add(box(0.05, 0.06, 0.2, metal, 0, 0.03, -0.06));
      g.add(box(0.045, 0.12, 0.06, metal2, 0, -0.05, 0.01));
      break;
    case 'smg':
      g.add(box(0.06, 0.08, 0.36, metal, 0, 0.02, -0.1));
      g.add(box(0.04, 0.16, 0.05, metal2, 0, -0.09, -0.12));
      g.add(box(0.045, 0.1, 0.06, metal2, 0, -0.05, 0.03));
      g.add(box(0.03, 0.03, 0.1, metal2, 0, 0.02, -0.33));
      break;
    case 'shotgun':
      g.add(box(0.06, 0.07, 0.6, metal, 0, 0.03, -0.18));
      g.add(box(0.07, 0.06, 0.24, wood, 0, -0.02, -0.25));
      g.add(box(0.06, 0.12, 0.2, wood, 0, -0.03, 0.15));
      break;
    case 'sniper':
      g.add(box(0.06, 0.07, 0.8, metal, 0, 0.02, -0.25));
      g.add(box(0.05, 0.05, 0.22, 0x111111, 0, 0.1, -0.12));
      g.add(box(0.065, 0.13, 0.26, metal2, 0, -0.03, 0.16));
      g.add(box(0.03, 0.12, 0.05, metal2, 0, -0.08, -0.02));
      break;
    default:
      // винтовка
      g.add(box(0.06, 0.08, 0.56, metal, 0, 0.02, -0.15));
      g.add(box(0.07, 0.06, 0.22, wood, 0, -0.01, -0.28));
      g.add(box(0.05, 0.16, 0.06, metal2, 0, -0.1, -0.1));
      g.add(box(0.06, 0.11, 0.2, wood, 0, -0.03, 0.17));
      g.add(box(0.025, 0.025, 0.14, metal2, 0, 0.03, -0.49));
  }
  return g;
}

/**
 * Магазин (у револьвера — барабан), вырезанный из модели: у самой модели этот объём скрыт
 * плоскостями отсечения, а копия модели показывает только его и двигается отдельно.
 * Нужен renderer.localClippingEnabled = true.
 */
class MagCut {
  /** точка подвеса магазина (верх по центру) в системе оружия; магазин поворачивается вокруг неё */
  readonly pivot = new THREE.Group();
  /** низ магазина относительно точки подвеса — за него берётся левая рука */
  readonly bottom: THREE.Vector3;
  /** точка подвеса в гнезде */
  readonly home: THREE.Vector3;
  private piece: THREE.Group;
  private localKeep: THREE.Plane[];
  private localCut: THREE.Plane[];
  private keep: THREE.Plane[];
  private cut: THREE.Plane[];

  /** магазин — отдельная деталь модели: геометрии поделены, отсечение не нужно */
  private split: boolean;

  constructor(
    private gun: THREE.Group,
    readonly box: THREE.Box3,
    split: Array<{ gun: THREE.BufferGeometry; mag: THREE.BufferGeometry }> | null = null,
  ) {
    const c = box.getCenter(new THREE.Vector3());
    this.pivot.position.set(c.x, box.max.y, c.z);
    this.home = this.pivot.position.clone();
    this.bottom = new THREE.Vector3(0, box.min.y - box.max.y, 0);
    const v = (x: number, y: number, z: number, w: number) => new THREE.Plane(new THREE.Vector3(x, y, z), w);
    // плоскости «внутрь» коробки: оставить только то, что внутри всех шести
    this.localKeep = [v(1, 0, 0, -box.min.x), v(-1, 0, 0, box.max.x), v(0, 1, 0, -box.min.y), v(0, -1, 0, box.max.y), v(0, 0, 1, -box.min.z), v(0, 0, -1, box.max.z)];
    this.localCut = this.localKeep.map((p) => p.clone().negate());
    this.keep = this.localKeep.map((p) => p.clone());
    this.cut = this.localCut.map((p) => p.clone());
    this.piece = gun.clone(true);
    this.piece.position.copy(this.pivot.position).negate();
    this.piece.rotation.set(0, 0, 0);
    this.piece.scale.set(1, 1, 1);
    this.split = !!split;
    if (split) {
      // сетки по порядку обхода: у оружия — без магазина, у копии — только магазин
      const setGeo = (root: THREE.Object3D, pick: (s: { gun: THREE.BufferGeometry; mag: THREE.BufferGeometry }) => THREE.BufferGeometry) => {
        let i = 0;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && split[i]) m.geometry = pick(split[i++]);
        });
      };
      setGeo(gun, (s) => s.gun);
      setGeo(this.piece, (s) => s.mag);
      this.localKeep = this.localCut = this.keep = this.cut = [];
      this.pivot.add(this.piece);
      gun.add(this.pivot);
      return;
    }
    const clip = (root: THREE.Object3D, planes: THREE.Plane[], inter: boolean) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const conv = (mm: THREE.Material) => {
          const c2 = mm.clone();
          c2.clippingPlanes = planes;
          c2.clipIntersection = inter;
          return c2;
        };
        m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
      });
    // у модели — вырезать объём (отсекается только пересечение — то есть внутренность коробки)
    clip(gun, this.cut, true);
    clip(this.piece, this.keep, false);
    this.pivot.add(this.piece);
    gun.add(this.pivot);
  }

  /** Плоскости — в мировой системе: пересчитать после движения оружия и магазина. */
  update() {
    if (this.split) return;
    for (let i = 0; i < 6; i++) {
      this.cut[i].copy(this.localCut[i]).applyMatrix4(this.gun.matrixWorld);
      this.keep[i].copy(this.localKeep[i]).applyMatrix4(this.piece.matrixWorld);
    }
  }
}

/** Всё про оружие в руках, что нужно анимации: точки рук, магазин, нож. */
interface Rig {
  kind: string;
  key: string;
  gun: THREE.Group;
  scale: number;
  twoHands: boolean;
  mag: MagCut | null;
  /** магазин без модели (блочное оружие): точка низа магазина в системе рук */
  magFallback: THREE.Vector3;
  homeL: THREE.Vector3;
  homeR: THREE.Vector3;
  sleeveR: THREE.Vector3;
  boltL: THREE.Vector3;
  portL: THREE.Vector3;
  /** плечо левой руки (камера): отсюда рукав тянется к кисти */
  shoulderL: THREE.Vector3;
  sleeveLHome: { pos: THREE.Vector3; quat: THREE.Quaternion };
  /** нож: группа наклона клинка (вращение kz — вокруг оси рукояти) */
  knifeTilt: THREE.Object3D | null;
  /** нож: группа переворота (kx) — у керамбита вокруг кольца, у штык-ножа вокруг рукояти */
  knifeSpin: THREE.Object3D | null;
  knifeKind: KnifeAnimKind;
}

/** Что из анимаций показать замороженным (стенд анимаций): вид и доля времени. */
export type VmLabAnim = 'draw' | 'reload' | 'swing' | 'swing2' | 'inspect' | null;

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private gunHolder = new THREE.Group();
  private guns = new Map<number, THREE.Group>();
  private rigs = new Map<number, Rig>();
  private rig: Rig | null = null;
  private flash: THREE.Mesh;
  private flashTime = 0;
  private kick = 0;
  private bob = 0;
  /** анимации: прошедшее время (−1 — не идёт) */
  private drawT = -1;
  private reloadT = -1;
  private reloadDur = 1;
  private reloadTrack: VmTrack | null = null;
  private swingT = -1;
  private swingN = 0;
  private pose = newVmPose();
  private current = -1;
  private sleeve: THREE.Mesh;
  private glove: THREE.Mesh;
  private sleeveL: THREE.Mesh;
  private gloveL: THREE.Mesh;
  /** в левой руке: патрон дробовика и скорозарядник револьвера */
  private shell: THREE.Group;
  private loader: THREE.Group;
  /** закладка/обезвреживание: оружие уходит вниз, видны бомба и руки над ней */
  private useGroup = new THREE.Group();
  private useKind: 'plant' | 'defuse' | null = null;
  private use = 0;
  private useT = 0;
  private useHandR: THREE.Group;
  private useHandL: THREE.Group;
  private cutters: THREE.Mesh;
  private useSleeves: THREE.Mesh[] = [];
  private useGloves: THREE.Mesh[] = [];
  /** стенд анимаций: оружие в руках и объём магазина (рамка) */
  get labRig(): { gun: THREE.Group; box: THREE.Box3 | null } | null {
    return this.rig ? { gun: this.rig.gun, box: this.rig.mag?.box ?? null } : null;
  }
  /** стенд анимаций: заморозить анимацию в доле времени */
  lab: { anim: VmLabAnim; k: number } | null = null;

  constructor(private skin: number) {
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b5a44, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);
    this.scene.add(this.root);
    this.root.add(this.gunHolder);
    this.sleeve = box(0.09, 0.09, 0.32, 0x5a6332, 0.04, -0.07, 0.24);
    this.glove = box(0.085, 0.085, 0.09, 0x3a3a30, 0.04, -0.06, 0.05);
    this.sleeveL = box(0.08, 0.08, 0.38, 0x5a6332, -0.12, -0.04, -0.06);
    this.gloveL = box(0.08, 0.08, 0.08, 0x3a3a30, -0.04, -0.03, -0.22);
    this.sleeveL.rotation.y = -0.5;
    this.root.add(this.sleeve, this.glove, this.sleeveL, this.gloveL);
    // патрон дробовика: красная гильза с латунным донцем, торчит из пальцев вперёд
    this.shell = new THREE.Group();
    this.shell.add(box(0.022, 0.022, 0.06, 0xb8282a, 0, 0.045, -0.035), box(0.024, 0.024, 0.014, 0xc9a23a, 0, 0.045, -0.002));
    // скорозарядник: тёмный диск с шестью латунными пулями сверху
    this.loader = new THREE.Group();
    this.loader.add(box(0.045, 0.016, 0.045, 0x2a2a2e, 0, 0.045, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.loader.add(box(0.009, 0.02, 0.009, 0xd2a93c, Math.cos(a) * 0.013, 0.062, Math.sin(a) * 0.013));
    }
    this.shell.visible = this.loader.visible = false;
    this.gloveL.add(this.shell, this.loader);
    this.flash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.gunHolder.add(this.flash);
    this.root.position.copy(ROOT0);
    // бомба: корпус, панель с кнопками, лампочка; руки — рукав и перчатка
    const bomb = new THREE.Group();
    bomb.add(box(0.26, 0.09, 0.16, 0x4a4f3a, 0, 0, 0));
    bomb.add(box(0.12, 0.012, 0.09, 0x1d1f1a, 0.04, 0.05, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) bomb.add(box(0.025, 0.012, 0.025, 0xc9c2a8, 0.005 + i * 0.033, 0.058, -0.022 + j * 0.044));
    bomb.add(box(0.03, 0.02, 0.03, 0xd02020, -0.08, 0.055, -0.04));
    bomb.add(box(0.07, 0.06, 0.05, 0x8a6a3a, -0.08, 0.02, 0.03)); // взрывчатка
    bomb.add(box(0.006, 0.006, 0.12, 0x2050c0, -0.04, 0.05, 0.02)); // провода
    bomb.add(box(0.006, 0.006, 0.12, 0xc03020, -0.03, 0.05, 0.02));
    this.useGroup.add(bomb);
    const hand = (side: number) => {
      const g = new THREE.Group();
      const sleeve = box(0.08, 0.08, 0.34, 0x5a6332, 0, 0.02, 0.2);
      const glove = box(0.075, 0.07, 0.08, 0x3a3a30, 0, 0, 0);
      sleeve.rotation.x = -0.35;
      this.useSleeves.push(sleeve);
      this.useGloves.push(glove);
      g.add(sleeve, glove);
      g.position.set(side * 0.07, 0.11, 0.06);
      this.useGroup.add(g);
      return g;
    };
    this.useHandR = hand(1);
    this.useHandL = hand(-1);
    this.cutters = box(0.02, 0.02, 0.09, 0x9aa0a6, 0, -0.03, -0.06);
    this.useHandR.add(this.cutters);
    this.useGroup.visible = false;
    this.scene.add(this.useGroup);
    // модель загрузилась позже блочной заглушки — пересобрать оружие в руках (анимации не сбрасывать)
    onGunModel(() => {
      for (const g of this.guns.values()) this.gunHolder.remove(g);
      this.guns.clear();
      this.rigs.clear();
      const id = this.current;
      this.current = -1;
      const keep = [this.drawT, this.reloadT, this.swingT];
      if (id >= 0) this.setWeapon(id);
      [this.drawT, this.reloadT, this.swingT] = keep;
    });
  }

  /** Закладка (нападение), обезвреживание (защита) или ничего. */
  setUse(kind: 'plant' | 'defuse' | null) {
    if (kind) this.cancelInspect();
    if (kind) this.useKind = kind;
    this.useTarget = kind ? 1 : 0;
  }
  private useTarget = 0;

  private team = 1;

  setTeam(team: number) {
    if (team !== this.team && (team === 0 || team === 1)) {
      this.team = team;
      // нож у сторон разный — пересобрать, если он в руках
      const cur = this.current;
      if (WEAPONS[cur]?.kind === 'knife') {
        this.current = -1;
        const d = this.drawT;
        this.setWeapon(cur);
        this.drawT = d;
      }
    }
    const sl = team === 0 ? 0xc2a77a : 0x2f4f7f;
    const gl = team === 0 ? 0x3a3a30 : 0x141518;
    for (const s of this.useSleeves) (s.material as THREE.MeshLambertMaterial).color.set(sl);
    for (const g of this.useGloves) (g.material as THREE.MeshLambertMaterial).color.set(gl);
    (this.sleeve.material as THREE.MeshLambertMaterial).color.set(sl);
    (this.sleeveL.material as THREE.MeshLambertMaterial).color.set(sl);
    (this.glove.material as THREE.MeshLambertMaterial).color.set(gl);
    (this.gloveL.material as THREE.MeshLambertMaterial).color.set(gl);
  }

  /** Собрать оружие и точки рук для него (один раз на оружие, потом из кэша). */
  private buildRig(def: WeaponDef | undefined, ck: number): Rig {
    const model = def ? gunModel(def.key) : null;
    const kind = def?.kind ?? 'pistol';
    const g = buildGun(def ?? WEAPONS[1], SKINS[this.skin]?.tint ?? 0xffffff, this.team, true);
    // нож: переворот через острие — вокруг кольца на пальце (керамбит) или середины рукояти
    let knifeSpin: THREE.Object3D | null = null;
    const knifeKind: KnifeAnimKind = KNIFE_OF_TEAM[this.team === 0 ? 0 : 1];
    if (kind === 'knife' && g.children[0]) {
      const tilt = g.children[0];
      const pivot = new THREE.Vector3();
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry.type === 'TorusGeometry') m.getWorldPosition(pivot);
      });
      const spin = new THREE.Group();
      const off = new THREE.Group();
      spin.position.copy(pivot);
      off.position.copy(pivot).negate();
      g.remove(tilt);
      off.add(tilt);
      spin.add(off);
      g.add(spin);
      knifeSpin = spin;
    }
    let mag: MagCut | null = null;
    if (model?.mag) {
      // у модели материалы общие с моделями в мире — вырез делаем на своих копиях (их делает MagCut)
      mag = new MagCut(g, model.mag, model.magSplit);
    }
    // нож — в правой перчатке; кисть поднята в кадр (керамбит в обратном хвате — выше: клинок вниз)
    if (kind === 'knife') g.position.copy(this.team === 0 ? VM_KNIFE_T : VM_KNIFE_CT);
    if (model) {
      // модель: точка хвата — в правой перчатке
      g.scale.setScalar(VM_SCALE);
      g.position.copy(VM_GRIP);
    }
    this.guns.set(ck, g);
    this.gunHolder.add(g);
    const twoHands = kind !== 'pistol' && kind !== 'knife' && kind !== 'grenade';
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    let homeR: THREE.Vector3, sleeveR: THREE.Vector3, homeL: THREE.Vector3, sleeveLPos: THREE.Vector3;
    const sleeveLQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.5, 0));
    if (model) {
      // правая перчатка — на рукояти модели, рукав уходит назад к краю экрана
      homeR = v(VM_GRIP.x + 0.03, VM_GRIP.y - 0.01, VM_GRIP.z + 0.01);
      sleeveR = v(VM_GRIP.x + 0.03, VM_GRIP.y - 0.02, VM_GRIP.z + 0.2);
      // левая перчатка — на цевье модели, рукав тянется к ней от левого края экрана
      if (model.fore) {
        const f = model.fore.clone().multiplyScalar(VM_SCALE).add(VM_GRIP);
        homeL = v(f.x - 0.02, f.y - 0.03, f.z);
        sleeveLPos = v(f.x - 0.1, f.y - 0.05, f.z + 0.17);
      } else {
        homeL = v(-0.04, -0.03, -0.22);
        sleeveLPos = v(-0.12, -0.04, -0.06);
      }
    } else if (kind === 'knife') {
      // перчатка на рукояти ножа, рукав — назад и вниз к краю экрана
      const k = this.team === 0 ? VM_KNIFE_T : VM_KNIFE_CT;
      homeR = k.clone();
      sleeveR = v(k.x + 0.01, k.y - 0.04, k.z + 0.19);
      homeL = v(-0.04, -0.03, -0.22);
      sleeveLPos = v(-0.12, -0.04, -0.06);
    } else {
      homeR = v(0.04, -0.06, 0.05);
      sleeveR = v(0.04, -0.07, 0.24);
      homeL = v(-0.04, -0.03, -0.22);
      sleeveLPos = v(-0.12, -0.04, -0.06);
    }
    // плечо: дальний конец рукава в покое (у пистолета — внизу слева за краем экрана)
    const shoulderL = twoHands ? sleeveLPos.clone().add(v(0, 0, SLEEVE_L_LEN / 2).applyQuaternion(sleeveLQuat)).add(ROOT0) : SHOULDER_OFF.clone().add(ROOT0);
    if (!twoHands) homeL = LEFT_OFF.clone();
    // затвор: сверху над рукоятью чуть впереди (у пистолета — задняя часть затвора)
    const sc = model ? VM_SCALE : 1;
    const len = model ? model.length * VM_SCALE : 0.5;
    const boltL = kind === 'pistol' ? v(-0.035, 0.035, 0.0).add(VM_GRIP) : v(-0.045, 0.045, -Math.min(0.12, len * 0.15)).add(VM_GRIP);
    // окно заряжания дробовика: снизу между рукоятью и цевьём
    const fore = model?.fore ? model.fore.clone().multiplyScalar(sc).add(VM_GRIP) : v(0, -0.03, -0.25);
    const portL = kind === 'shotgun' ? v(-0.01, VM_GRIP.y - 0.07, VM_GRIP.z + (fore.z - VM_GRIP.z) * 0.45) : v(-0.04, -0.05, -0.08);
    const kt = knifeSpin ? (knifeSpin.children[0].children[0] ?? null) : null;
    return {
      kind,
      key: def?.key ?? '',
      gun: g,
      scale: sc,
      twoHands,
      mag,
      magFallback: model ? v(0, -0.1, -0.09).add(VM_GRIP) : v(0, -0.18, -0.1),
      homeL,
      homeR,
      sleeveR,
      boltL,
      portL,
      shoulderL,
      sleeveLHome: { pos: sleeveLPos, quat: sleeveLQuat },
      knifeTilt: kt,
      knifeSpin,
      knifeKind,
    };
  }

  setWeapon(id: number) {
    if (id === this.current) return;
    this.cancelInspect();
    this.current = id;
    for (const g of this.guns.values()) g.visible = false;
    const def = WEAPONS[id];
    // нож у каждой стороны свой — в кэше под отдельным ключом
    const ck = def?.kind === 'knife' ? 1000 + this.team : id;
    let rig = this.rigs.get(ck);
    if (!rig) {
      rig = this.buildRig(def, ck);
      this.rigs.set(ck, rig);
    }
    this.rig = rig;
    rig.gun.visible = true;
    const model = def ? gunModel(def.key) : null;
    if (model) this.flash.position.copy(model.muzzle).multiplyScalar(VM_SCALE).add(VM_GRIP);
    else {
      const k = def?.kind;
      const len = k === 'sniper' ? 0.65 : k === 'shotgun' ? 0.5 : k === 'rifle' ? 0.55 : k === 'smg' ? 0.38 : k === 'knife' ? 0.25 : 0.18;
      this.flash.position.set(0, 0.02, -len);
    }
    this.glove.position.copy(rig.homeR);
    this.sleeve.position.copy(rig.sleeveR);
    this.gloveL.position.copy(rig.homeL);
    this.restoreLeftSleeve();
    this.gloveL.visible = this.sleeveL.visible = rig.twoHands;
    // доставание; перезарядка прерывается сменой оружия (как на сервере)
    this.drawT = 0;
    this.reloadT = -1;
    this.swingT = -1;
  }

  // ---------- Осмотр оружия (F) ----------
  private inspectT = -1;
  private inspectAnim = inspectOf('rifle');

  /** Начать осмотр (если не идёт смена оружия, перезарядка, удар или закладка). */
  inspect() {
    if (this.inspectT >= 0 || this.drawT >= 0 || this.reloadT >= 0 || this.swingT >= 0 || this.useTarget > 0) return;
    const kind = this.rig?.kind ?? 'rifle';
    this.inspectAnim = inspectOf(kind, this.rig?.knifeKind);
    this.inspectT = 0;
  }

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private static readonly AXIS_Z = new THREE.Vector3(0, 0, 1);

  /**
   * Левый рукав тянется к кисти от неподвижного «плеча» у края экрана — рука не отрывается
   * и не уходит вверх вместе со стволом, когда оружие поворачивается или кисть идёт к магазину.
   */
  private fitLeftSleeve(shoulderCam: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    const a = this.root.worldToLocal(this.tmpA.copy(shoulderCam)); // плечо в системе рук
    const g = this.gloveL.position;
    const dir = this.tmpB.copy(a).sub(g);
    const len = Math.max(0.05, dir.length());
    dir.divideScalar(len);
    this.sleeveL.position.copy(g).addScaledVector(dir, len / 2);
    this.sleeveL.quaternion.copy(this.tmpQ.setFromUnitVectors(ViewModel.AXIS_Z, dir));
    this.sleeveL.scale.set(1, 1, len / SLEEVE_L_LEN);
  }

  private restoreLeftSleeve() {
    const r = this.rig;
    if (!r) return;
    this.sleeveL.position.copy(r.sleeveLHome.pos);
    this.sleeveL.quaternion.copy(r.sleeveLHome.quat);
    this.sleeveL.scale.set(1, 1, 1);
  }

  /** Прервать осмотр: выстрел, перезарядка, смена оружия, прицел. */
  cancelInspect() {
    this.inspectT = -1;
  }

  get inspecting(): boolean {
    return this.inspectT >= 0;
  }

  fire() {
    this.cancelInspect();
    if (this.rig?.kind === 'knife') {
      // удары ножом чередуются: слева направо, потом справа налево
      this.swingT = 0;
      this.swingN++;
      return;
    }
    this.kick = 1;
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  reload(dur: number) {
    this.cancelInspect();
    const r = this.rig;
    if (!r || r.kind === 'knife' || r.kind === 'grenade') return;
    this.reloadT = 0;
    this.reloadDur = Math.max(0.1, dur);
    this.reloadTrack = reloadTrack(r.kind, r.key);
  }

  update(dt: number, speed: number, aspect: number, visible: boolean, scoped: boolean) {
    this.root.visible = visible && !scoped;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bob += dt * speed * 1.6;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    const rig = this.rig;
    const pose = this.pose;
    clearVmPose(pose);
    if (scoped || !visible) this.cancelInspect();
    const lab = this.lab;
    if (lab) {
      // стенд: одна анимация в заданной доле времени
      if (rig && lab.anim === 'draw') drawTrack(rig.kind, rig.knifeKind).sample(lab.k, pose);
      if (rig && lab.anim === 'reload') reloadTrack(rig.kind, rig.key).sample(lab.k, pose);
      if (lab.anim === 'swing' || lab.anim === 'swing2') (lab.anim === 'swing' ? SWING_LR : SWING_RL).sample(lab.k, pose);
      if (lab.anim === 'inspect') {
        const kind = rig?.kind ?? 'rifle';
        inspectOf(kind, rig?.knifeKind).track.sample(lab.k, pose);
      }
    } else {
      // доставание (время = задержка выстрела после смены оружия на сервере)
      if (this.drawT >= 0 && rig) {
        this.drawT += dt;
        const k = this.drawT / DRAW_TIME;
        if (k >= 1) this.drawT = -1;
        else drawTrack(rig.kind, rig.knifeKind).sample(k, pose);
      }
      if (this.reloadT >= 0 && this.reloadTrack) {
        this.reloadT += dt;
        const k = this.reloadT / this.reloadDur;
        if (k >= 1) this.reloadT = -1;
        else this.reloadTrack.sample(k, pose);
      }
      if (this.swingT >= 0) {
        this.swingT += dt;
        const k = this.swingT / SWING_DUR;
        if (k >= 1) this.swingT = -1;
        else (this.swingN % 2 ? SWING_LR : SWING_RL).sample(k, pose);
      }
      if (this.inspectT >= 0) {
        this.inspectT += dt;
        const k = this.inspectT / this.inspectAnim.dur;
        if (k >= 1) this.inspectT = -1;
        else this.inspectAnim.track.sample(k, pose);
      }
    }
    // закладка/обезвреживание: оружие опускается за край экрана, снизу поднимаются бомба и руки
    this.use += (this.useTarget - this.use) * (1 - Math.exp(-dt * 10));
    this.useT = this.useTarget > 0 ? this.useT + dt : 0;
    const dip = this.use * 0.6;
    const u = this.use;
    this.useGroup.visible = visible && u > 0.02;
    if (this.useGroup.visible) {
      const plant = this.useKind === 'plant';
      this.useGroup.position.set(0.02, -0.34 - (1 - u) * 0.35, -0.55);
      this.useGroup.rotation.set(0.55, 0, 0);
      this.cutters.visible = !plant;
      const t = this.useT;
      if (plant) {
        // набор кода: пальцы по очереди нажимают кнопки
        const tap = Math.sin(t * 13);
        this.useHandR.position.set(0.04, 0.1 + 0.025 * Math.max(0, tap), 0.03);
        this.useHandL.position.set(-0.1, 0.09 + 0.025 * Math.max(0, -tap), 0.05);
      } else {
        // разминирование: левая держит корпус, правая с кусачками ходит по проводам
        this.useHandL.position.set(-0.13, 0.07, 0.05);
        this.useHandR.position.set(-0.035 + Math.sin(t * 2.2) * 0.03, 0.09 + 0.012 * Math.sin(t * 9), 0.02 + Math.cos(t * 2.2) * 0.02);
      }
    }
    const bx = Math.sin(this.bob) * 0.012 * Math.min(1, speed / 5);
    const by = Math.abs(Math.cos(this.bob)) * 0.012 * Math.min(1, speed / 5);
    // нож в покое — ниже и правее, острие вперёд-вверх
    const knife = rig?.kind === 'knife';
    const p = pose.p,
      r = pose.r;
    if (knife) {
      for (let j = 0; j < 3; j++) (p[j] += KNIFE_REST_P[j]), (r[j] += KNIFE_REST_R[j]);
      // керамбит короче и загнут вниз — держим выше, иначе клинок уходит за край экрана
      if (this.team === 0) p[1] += 0.06;
    }
    this.root.position.set(ROOT0.x + bx + p[0], ROOT0.y - by - dip + p[1], ROOT0.z + this.kick * 0.05 + p[2]);
    this.root.rotation.set(this.kick * 0.12 + dip * 0.8 + r[0], r[1], dip * 0.5 + r[2]);
    if (!rig) return;
    if (rig.knifeTilt) rig.knifeTilt.rotation.z = pose.kz;
    if (rig.knifeSpin) rig.knifeSpin.rotation.x = pose.kx;
    // магазин: смещение от гнезда (pose.m — в метрах системы рук, вдоль осей оружия)
    const sc = rig.scale;
    const magAt = this.tmpA;
    if (rig.mag) {
      const pv = rig.mag.pivot;
      const home = rig.mag.home;
      pv.rotation.set(pose.mr[0], pose.mr[1], pose.mr[2]);
      pv.position.set(home.x + pose.m[0] / sc, home.y + pose.m[1] / sc, home.z + pose.m[2] / sc);
      // середина магазина в системе рук: за неё держится левая кисть
      magAt.copy(rig.mag.bottom).multiplyScalar(0.9).applyEuler(pv.rotation).add(pv.position).multiplyScalar(sc).add(rig.gun.position);
    } else {
      // у модели нет отдельного магазина: он остаётся в оружии, рука только дотягивается до него
      magAt.copy(rig.magFallback);
    }
    // левая кисть: от своего места к магазину / затвору / окну заряжания, плюс смещение
    const wm = pose.hm,
      wb = pose.hb,
      wp = pose.hp;
    const lMoved = wm + wb + wp > 0.002 || Math.abs(pose.l[0]) + Math.abs(pose.l[1]) + Math.abs(pose.l[2]) > 0.001;
    const gl = this.gloveL.position;
    gl.copy(rig.homeL);
    if (lMoved) {
      // кисть под магазином чуть ниже его дна; у револьвера «окно» — сам барабан
      const port = rig.mag && rig.kind === 'pistol' ? this.tmpB.copy(magAt).add(new THREE.Vector3(-0.005, 0.0, 0.03)) : rig.portL;
      gl.x += (magAt.x - 0.02 - rig.homeL.x) * wm + (rig.boltL.x - rig.homeL.x) * wb + (port.x - rig.homeL.x) * wp + pose.l[0];
      gl.y += (magAt.y - 0.025 - rig.homeL.y) * wm + (rig.boltL.y - rig.homeL.y) * wb + (port.y - rig.homeL.y) * wp + pose.l[1];
      gl.z += (magAt.z + 0.02 - rig.homeL.z) * wm + (rig.boltL.z - rig.homeL.z) * wb + (port.z - rig.homeL.z) * wp + pose.l[2];
    }
    this.gloveL.visible = this.sleeveL.visible = rig.twoHands || wm + wb + wp > 0.03;
    this.shell.visible = pose.s > 0.5 && rig.kind === 'shotgun';
    this.loader.visible = pose.s > 0.5 && rig.kind === 'pistol';
    // правая кисть (затвор снайперки)
    this.glove.position.set(rig.homeR.x + pose.rh[0], rig.homeR.y + pose.rh[1], rig.homeR.z + pose.rh[2]);
    this.sleeve.position.set(rig.sleeveR.x + pose.rh[0] * 0.5, rig.sleeveR.y + pose.rh[1] * 0.5, rig.sleeveR.z + pose.rh[2] * 0.5);
    // рукав тянется к кисти, когда оружие поворачивается или кисть ушла со своего места
    const turned = Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) > 0.002;
    if (this.sleeveL.visible && (lMoved || turned || !rig.twoHands)) this.fitLeftSleeve(rig.shoulderL);
    else this.restoreLeftSleeve();
    if (rig.mag) {
      this.root.updateMatrixWorld(true);
      rig.mag.update();
    }
  }
}
