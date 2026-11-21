// Оружие и руки от первого лица: блочные модели с пиксельными цветами,
// покачивание при ходьбе, отдача, вспышка выстрела, анимация перезарядки.

import * as THREE from 'three';
import { SKINS, WEAPONS, type WeaponDef } from '../../../shared/src/index';
import { cloneGun, gunModel, onGunModel } from './weaponModels';

/** где правая перчатка держит рукоять (система root) и масштаб моделей от первого лица */
const VM_GRIP = new THREE.Vector3(0.0, -0.025, -0.01);
const VM_SCALE = 0.85;

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

/** Оружие: модель из пака, если загружена, иначе блочное. Начало — точка хвата, дуло вдоль −Z. */
export function buildGun(def: WeaponDef, tint: number): THREE.Group {
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
    case 'knife':
      g.add(box(0.03, 0.05, 0.12, 0x2a2420, 0, 0, 0.05));
      g.add(box(0.012, 0.045, 0.22, 0xb9c0c6, 0, 0.01, -0.12));
      break;
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

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private gunHolder = new THREE.Group();
  private guns = new Map<number, THREE.Group>();
  private flash: THREE.Mesh;
  private flashTime = 0;
  private kick = 0;
  private bob = 0;
  private reloadT = 0;
  private reloadDur = 0;
  private switchT = 0;
  private current = -1;
  private sleeve: THREE.Mesh;
  private glove: THREE.Mesh;
  private sleeveL: THREE.Mesh;
  private gloveL: THREE.Mesh;
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
    this.flash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.gunHolder.add(this.flash);
    this.root.position.set(0.22, -0.24, -0.42);
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
    // модель загрузилась позже блочной заглушки — пересобрать оружие в руках
    onGunModel(() => {
      for (const g of this.guns.values()) this.gunHolder.remove(g);
      this.guns.clear();
      const id = this.current;
      this.current = -1;
      if (id >= 0) this.setWeapon(id);
    });
  }

  /** Закладка (нападение), обезвреживание (защита) или ничего. */
  setUse(kind: 'plant' | 'defuse' | null) {
    if (kind) this.useKind = kind;
    this.useTarget = kind ? 1 : 0;
  }
  private useTarget = 0;

  setTeam(team: number) {
    const sl = team === 0 ? 0xc2a77a : 0x2f4f7f;
    const gl = team === 0 ? 0x3a3a30 : 0x141518;
    for (const s of this.useSleeves) (s.material as THREE.MeshLambertMaterial).color.set(sl);
    for (const g of this.useGloves) (g.material as THREE.MeshLambertMaterial).color.set(gl);
    (this.sleeve.material as THREE.MeshLambertMaterial).color.set(sl);
    (this.sleeveL.material as THREE.MeshLambertMaterial).color.set(sl);
    (this.glove.material as THREE.MeshLambertMaterial).color.set(gl);
    (this.gloveL.material as THREE.MeshLambertMaterial).color.set(gl);
  }

  setWeapon(id: number) {
    if (id === this.current) return;
    this.current = id;
    for (const g of this.guns.values()) g.visible = false;
    const def = WEAPONS[id];
    const model = def ? gunModel(def.key) : null;
    let g = this.guns.get(id);
    if (!g) {
      g = buildGun(def ?? WEAPONS[1], SKINS[this.skin]?.tint ?? 0xffffff);
      if (model) {
        // модель: точка хвата — в правой перчатке
        g.scale.setScalar(VM_SCALE);
        g.position.copy(VM_GRIP);
      }
      this.guns.set(id, g);
      this.gunHolder.add(g);
    }
    g.visible = true;
    const twoHands = def?.kind !== 'pistol' && def?.kind !== 'knife' && def?.kind !== 'grenade';
    if (model) {
      // правая перчатка — на рукояти модели, рукав уходит назад к краю экрана
      this.glove.position.set(VM_GRIP.x + 0.03, VM_GRIP.y - 0.01, VM_GRIP.z + 0.01);
      this.sleeve.position.set(VM_GRIP.x + 0.03, VM_GRIP.y - 0.02, VM_GRIP.z + 0.2);
      this.flash.position.copy(model.muzzle).multiplyScalar(VM_SCALE).add(VM_GRIP);
      // левая перчатка — на цевье модели, рукав тянется к ней от левого края экрана
      if (model.fore) {
        const f = model.fore.clone().multiplyScalar(VM_SCALE).add(VM_GRIP);
        this.gloveL.position.set(f.x - 0.02, f.y - 0.03, f.z);
        this.sleeveL.position.set(f.x - 0.1, f.y - 0.05, f.z + 0.17);
      }
    } else {
      const len = def?.kind === 'sniper' ? 0.65 : def?.kind === 'shotgun' ? 0.5 : def?.kind === 'rifle' ? 0.55 : def?.kind === 'smg' ? 0.38 : def?.kind === 'knife' ? 0.25 : 0.18;
      this.flash.position.set(0, 0.02, -len);
      this.glove.position.set(0.04, -0.06, 0.05);
      this.sleeve.position.set(0.04, -0.07, 0.24);
      this.gloveL.position.set(-0.04, -0.03, -0.22);
      this.sleeveL.position.set(-0.12, -0.04, -0.06);
    }
    this.gloveL.visible = this.sleeveL.visible = twoHands;
    this.switchT = 0.3;
  }

  fire() {
    this.kick = 1;
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  reload(dur: number) {
    this.reloadT = dur;
    this.reloadDur = dur;
  }

  update(dt: number, speed: number, aspect: number, visible: boolean, scoped: boolean) {
    this.root.visible = visible && !scoped;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bob += dt * speed * 1.6;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.switchT = Math.max(0, this.switchT - dt);
    let dip = this.switchT * 0.9;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const k = 1 - this.reloadT / this.reloadDur;
      dip += Math.sin(Math.min(1, k) * Math.PI) * 0.22;
    }
    // закладка/обезвреживание: оружие опускается за край экрана, снизу поднимаются бомба и руки
    this.use += (this.useTarget - this.use) * (1 - Math.exp(-dt * 10));
    this.useT = this.useTarget > 0 ? this.useT + dt : 0;
    dip += this.use * 0.6;
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
    this.root.position.set(0.22 + bx, -0.24 - by - dip, -0.42 + this.kick * 0.05);
    this.root.rotation.set(this.kick * 0.12 + dip * 0.8, 0, dip * 0.5);
  }
}
