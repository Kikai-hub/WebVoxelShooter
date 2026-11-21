// Модели оружия (Low Poly Weapons Pack, автор Zsky, лицензия CC BY 4.0 — см. public/models/weapons/License.txt).
// Грузятся один раз в фоне из public/models/weapons (OBJ + MTL). Каждая модель приводится к виду:
// дуло вдоль −Z, длина в метрах, начало координат — в точке хвата правой рукой.
// Пока модель не загрузилась (или её нет — нож, гранаты), используется блочное оружие.

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

interface GunModelDef {
  file: string;
  /** как лежит исходник: дуло вдоль +X или +Z (тогда разворачиваем), по умолчанию −Z */
  muzzle?: '+x' | '+z';
  /** длина от приклада до дула, м */
  length: number;
  /** доли от приклада (0) к дулу (1) и от низа (0) к верху (1): рукоять, цевьё, ось ствола */
  grip: [number, number];
  fore?: [number, number];
  bore: number;
}

/** Ключ оружия игры → модель. Точки хвата сняты по стенду /weapons.html. */
const DEFS: Record<string, GunModelDef> = {
  osa: { file: 'Pistol_02', length: 0.2, grip: [0.23, 0.47], bore: 0.87 },
  gyurza: { file: 'Pistol_03', muzzle: '+z', length: 0.27, grip: [0.23, 0.37], bore: 0.83 },
  shmel: { file: 'SubmachineGun_02', length: 0.55, grip: [0.385, 0.43], fore: [0.77, 0.76], bore: 0.86 },
  molot: { file: 'Shotgun_01', muzzle: '+x', length: 0.85, grip: [0.29, 0.58], fore: [0.69, 0.67], bore: 0.85 },
  vikhr: { file: 'AssaultRifle_01', length: 0.8, grip: [0.29, 0.47], fore: [0.65, 0.74], bore: 0.84 },
  sokol: { file: 'SniperRifle_01', length: 0.95, grip: [0.29, 0.38], fore: [0.65, 0.62], bore: 0.65 },
  // остальное оружие пака (у части моделей дуло в исходнике смотрит назад — muzzle '+z')
  m4a1: { file: 'AssaultRifle_02', length: 0.8, grip: [0.36, 0.36], fore: [0.66, 0.62], bore: 0.72 },
  // буллпап: рукоять далеко от затыльника; берём ближе к прикладу, чтобы он не уходил сквозь плечо
  aug: { file: 'AssaultRifle_03', muzzle: '+z', length: 0.7, grip: [0.4, 0.41], fore: [0.8, 0.66], bore: 0.77 },
  awm: { file: 'SniperRifle_02', length: 1.05, grip: [0.27, 0.36], fore: [0.6, 0.45], bore: 0.55 },
  mac10: { file: 'SubmachineGun_01', muzzle: '+z', length: 0.3, grip: [0.33, 0.42], fore: [0.8, 0.56], bore: 0.9 },
  ump: { file: 'SubmachineGun_04', muzzle: '+z', length: 0.6, grip: [0.38, 0.31], fore: [0.78, 0.64], bore: 0.75 },
  skorpion: { file: 'SubmachineGun_05', length: 0.45, grip: [0.14, 0.39], fore: [0.55, 0.6], bore: 0.88 },
  sawedoff: { file: 'Shotgun_03', length: 0.6, grip: [0.14, 0.37], fore: [0.61, 0.73], bore: 0.9 },
  beretta: { file: 'Pistol_01', muzzle: '+z', length: 0.22, grip: [0.19, 0.34], bore: 0.84 },
  python: { file: 'Revolver_01', muzzle: '+z', length: 0.24, grip: [0.19, 0.37], bore: 0.88 },
  sw29: { file: 'Revolver_02', muzzle: '+z', length: 0.3, grip: [0.11, 0.29], bore: 0.92 },
};

export interface GunModel {
  /** шаблон: начало — точка хвата, дуло вдоль −Z */
  template: THREE.Group;
  /** точки относительно хвата, м: цевьё (левая рука), дуло, затыльник приклада */
  fore: THREE.Vector3 | null;
  muzzle: THREE.Vector3;
  length: number;
}

const models = new Map<string, GunModel>();
const listeners: Array<() => void> = [];
let started = false;

/** Начать загрузку (один раз). */
export function loadGunModels(base = `${import.meta.env.BASE_URL}models/weapons/`) {
  if (started) return;
  started = true;
  for (const [key, def] of Object.entries(DEFS)) {
    new MTLLoader().setPath(base).load(
      `${def.file}.mtl`,
      (mtl) => {
        mtl.preload();
        new OBJLoader()
          .setMaterials(mtl)
          .setPath(base)
          .load(
            `${def.file}.obj`,
            (obj) => {
              models.set(key, normalize(obj, def));
              for (const l of listeners) l();
            },
            undefined,
            () => {},
          );
      },
      undefined,
      () => {},
    );
  }
}

/** Вызвать cb каждый раз, когда загрузилась очередная модель. */
export function onGunModel(cb: () => void) {
  listeners.push(cb);
}

export function gunModel(key: string): GunModel | null {
  return models.get(key) ?? null;
}

/** Передать позе агента цевьё модели (куда тянется левая рука); без модели — по виду оружия. */
export function applyFore(an: { foreD: number; foreUp: number }, key: string | undefined) {
  const m = key ? models.get(key) : null;
  an.foreD = m?.fore ? -m.fore.z : 0;
  an.foreUp = m?.fore ? m.fore.y : 0;
}

/** Копия модели с раскраской (tint умножает цвет, слегка). Геометрия общая. */
export function cloneGun(key: string, tint = 0xffffff): THREE.Group | null {
  const m = models.get(key);
  if (!m) return null;
  const g = m.template.clone(true);
  // геометрия общая с шаблоном: при удалении копии её нельзя освобождать (см. disposeGun)
  g.userData.sharedGeometry = true;
  if (tint !== 0xffffff) {
    const t = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const tinted = mats.map((mm) => {
        const c = (mm as THREE.MeshLambertMaterial).clone();
        c.color.multiply(t);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? tinted : tinted[0];
    });
  }
  return g;
}

/** Освободить объект с оружием: свою геометрию — да, общую геометрию моделей — нет. */
export function disposeGun(root: THREE.Object3D) {
  root.traverse((o) => {
    let shared = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.sharedGeometry) shared = true;
    if (!shared) (o as THREE.Mesh).geometry?.dispose();
  });
}

function normalize(obj: THREE.Group, def: GunModelDef): GunModel {
  // материалы: матовые, с плоскими гранями — как остальной мир; цвет из MTL, чуть светлее
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: THREE.Material) => {
      const src = m as THREE.MeshPhongMaterial;
      const color = (src.color ?? new THREE.Color(0x333333)).clone();
      // почти чёрный металл в игре сливается с тенью — поднимаем минимум яркости
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      if (hsl.l < 0.08) color.setHSL(hsl.h, hsl.s, 0.08 + hsl.l * 0.5);
      return new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    mesh.castShadow = false;
  });
  const holder = new THREE.Group();
  holder.add(obj);
  obj.rotation.y = def.muzzle === '+x' ? Math.PI / 2 : def.muzzle === '+z' ? Math.PI : 0;
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const k = def.length / box.getSize(new THREE.Vector3()).z;
  obj.scale.setScalar(k);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const h = box.max.y - box.min.y;
  const at = (along: number, up: number) => new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + up * h, box.max.z - along * def.length);
  const grip = at(def.grip[0], def.grip[1]);
  obj.position.sub(grip);
  const rel = (p: THREE.Vector3) => p.sub(grip);
  return {
    template: holder,
    fore: def.fore ? rel(at(def.fore[0], def.fore[1])) : null,
    muzzle: rel(at(1, def.bore)),
    length: def.length,
  };
}
