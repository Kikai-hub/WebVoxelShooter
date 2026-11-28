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
  /**
   * Магазин (у револьверов — барабан) для анимации перезарядки: доли вдоль [от, до] и по высоте [низ, верх].
   * Этот объём вырезается из модели и двигается отдельно (разрез плоскостями отсечения).
   * Только для моделей, где магазин не отдельная деталь (пистолеты, револьверы).
   */
  mag?: [number, number, number, number];
  /**
   * Магазин — отдельная деталь модели (связный кусок сетки): берутся детали, у которых центр
   * их габарита попал в [вдоль от, до, высота от, до]. Деталь отделяется целиком — без обрезков.
   */
  magPart?: [number, number, number, number];
}

/** Ключ оружия игры → модель. Точки хвата сняты по стенду /weapons.html. */
const DEFS: Record<string, GunModelDef> = {
  osa: { file: 'Pistol_02', length: 0.2, grip: [0.23, 0.47], bore: 0.87, mag: [0.1, 0.34, 0, 0.36] },
  gyurza: { file: 'Pistol_03', muzzle: '+z', length: 0.27, grip: [0.23, 0.37], bore: 0.83, mag: [0.1, 0.34, 0, 0.3] },
  shmel: { file: 'SubmachineGun_02', length: 0.55, grip: [0.385, 0.43], fore: [0.77, 0.76], bore: 0.86, magPart: [0.57, 0.72, 0, 0.4] },
  molot: { file: 'Shotgun_01', muzzle: '+x', length: 0.85, grip: [0.29, 0.58], fore: [0.69, 0.67], bore: 0.85 },
  vikhr: { file: 'AssaultRifle_01', length: 0.8, grip: [0.29, 0.47], fore: [0.65, 0.74], bore: 0.84, magPart: [0.42, 0.6, 0, 0.5] },
  sokol: { file: 'SniperRifle_01', length: 0.95, grip: [0.29, 0.38], fore: [0.65, 0.62], bore: 0.65 },
  // остальное оружие пака (у части моделей дуло в исходнике смотрит назад — muzzle '+z')
  m4a1: { file: 'AssaultRifle_02', length: 0.8, grip: [0.36, 0.36], fore: [0.66, 0.62], bore: 0.72, magPart: [0.44, 0.56, 0, 0.4] },
  // буллпап: рукоять далеко от затыльника; берём ближе к прикладу, чтобы он не уходил сквозь плечо
  aug: { file: 'AssaultRifle_03', muzzle: '+z', length: 0.7, grip: [0.4, 0.41], fore: [0.8, 0.66], bore: 0.77, magPart: [0.19, 0.33, 0, 0.4] },
  awm: { file: 'SniperRifle_02', length: 1.05, grip: [0.27, 0.36], fore: [0.6, 0.45], bore: 0.55, magPart: [0.33, 0.4, 0.15, 0.4] },
  mac10: { file: 'SubmachineGun_01', muzzle: '+z', length: 0.3, grip: [0.33, 0.42], fore: [0.8, 0.56], bore: 0.9, magPart: [0.26, 0.4, 0, 0.3] },
  ump: { file: 'SubmachineGun_04', muzzle: '+z', length: 0.6, grip: [0.38, 0.31], fore: [0.78, 0.64], bore: 0.75 },
  skorpion: { file: 'SubmachineGun_05', length: 0.45, grip: [0.14, 0.39], fore: [0.55, 0.6], bore: 0.88, magPart: [0.44, 0.68, 0, 0.45] },
  sawedoff: { file: 'Shotgun_03', length: 0.6, grip: [0.14, 0.37], fore: [0.61, 0.73], bore: 0.9 },
  beretta: { file: 'Pistol_01', muzzle: '+z', length: 0.22, grip: [0.19, 0.34], bore: 0.84, mag: [0.08, 0.3, 0, 0.3] },
  python: { file: 'Revolver_01', muzzle: '+z', length: 0.24, grip: [0.19, 0.37], bore: 0.88, mag: [0.38, 0.56, 0.45, 0.82] },
  sw29: { file: 'Revolver_02', muzzle: '+z', length: 0.3, grip: [0.11, 0.29], bore: 0.92, mag: [0.27, 0.42, 0.42, 0.8] },
};

export interface GunModel {
  /** шаблон: начало — точка хвата, дуло вдоль −Z */
  template: THREE.Group;
  /** точки относительно хвата, м: цевьё (левая рука), дуло, затыльник приклада */
  fore: THREE.Vector3 | null;
  muzzle: THREE.Vector3;
  length: number;
  /** объём магазина (барабана) относительно хвата, м; нет — у дробовиков и моделей без отдельного магазина */
  mag: THREE.Box3 | null;
  /** магазин отдельной деталью: сетки модели без магазина и только магазин (по порядку обхода сеток) */
  magSplit: Array<{ gun: THREE.BufferGeometry; mag: THREE.BufferGeometry }> | null;
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
  // магазин отдельной деталью: выбрать детали по габариту (в долях длины и высоты, ещё до сдвига к хвату)
  let magSplit: GunModel['magSplit'] = null;
  let partBox: THREE.Box3 | null = null;
  if (def.magPart) {
    const [a0, a1, u0, u1] = def.magPart;
    const split = splitParts(obj, (c) => {
      const along = (box.max.z - c.z) / def.length,
        up = (c.y - box.min.y) / h;
      return along >= a0 && along <= a1 && up >= u0 && up <= u1;
    });
    if (split) {
      magSplit = split.parts;
      partBox = split.box.translate(grip.clone().negate());
    }
  }
  obj.position.sub(grip);
  const rel = (p: THREE.Vector3) => p.sub(grip);
  return {
    template: holder,
    fore: def.fore ? rel(at(def.fore[0], def.fore[1])) : null,
    muzzle: rel(at(1, def.bore)),
    length: def.length,
    magSplit,
    mag: partBox
      ? partBox
      : def.mag
      ? new THREE.Box3(
          rel(at(def.mag[1], def.mag[2])).setX(box.min.x - grip.x - 0.01).add(new THREE.Vector3(0, def.mag[2] === 0 ? -0.02 : 0, 0)),
          rel(at(def.mag[0], def.mag[3])).setX(box.max.x - grip.x + 0.01),
        )
      : null,
  };
}

/**
 * Разделить сетки модели на «всё, кроме магазина» и «магазин». Деталь — связный кусок сетки
 * (треугольники, соединённые общими вершинами); take() решает по центру габарита детали
 * (в системе держателя модели). Возвращает новые геометрии по каждой сетке и габарит магазина.
 */
function splitParts(obj: THREE.Object3D, take: (center: THREE.Vector3) => boolean): { parts: Array<{ gun: THREE.BufferGeometry; mag: THREE.BufferGeometry }>; box: THREE.Box3 } | null {
  obj.updateMatrixWorld(true);
  const parts: Array<{ gun: THREE.BufferGeometry; mag: THREE.BufferGeometry }> = [];
  const magBox = new THREE.Box3();
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geo.getAttribute('position');
    const nTri = pos.count / 3;
    // детали: объединяем треугольники с совпадающими вершинами
    const ids = new Map<string, number>();
    const parent: number[] = [];
    const find = (a: number): number => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    const vid = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = parent.length;
        parent.push(id);
        ids.set(key, id);
      }
      vid[i] = id;
    }
    for (let t = 0; t < nTri; t++) {
      const a = find(vid[t * 3]);
      for (let j = 1; j < 3; j++) {
        const b = find(vid[t * 3 + j]);
        if (a !== b) parent[b] = a;
      }
    }
    // габарит каждой детали (в системе держателя)
    const boxes = new Map<number, THREE.Box3>();
    for (let i = 0; i < pos.count; i++) {
      const r = find(vid[i]);
      let b = boxes.get(r);
      if (!b) boxes.set(r, (b = new THREE.Box3()));
      b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
    const isMag = new Map<number, boolean>();
    for (const [r, b] of boxes) isMag.set(r, take(b.getCenter(v)));
    const magTri = (t: number) => isMag.get(find(vid[t * 3])) === true;
    let any = false;
    for (let t = 0; t < nTri && !any; t++) any = magTri(t);
    if (!any) {
      parts.push({ gun: mesh.geometry, mag: new THREE.BufferGeometry() });
      return;
    }
    for (const [r, b] of boxes) if (isMag.get(r)) magBox.union(b);
    parts.push({ gun: pickTriangles(geo, (t) => !magTri(t)), mag: pickTriangles(geo, magTri) });
  });
  return magBox.isEmpty() ? null : { parts, box: magBox };
}

/** Новая геометрия из выбранных треугольников (с сохранением групп материалов). */
function pickTriangles(geo: THREE.BufferGeometry, keep: (tri: number) => boolean): THREE.BufferGeometry {
  const nTri = geo.getAttribute('position').count / 3;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: nTri * 3, materialIndex: 0 }];
  const order: number[] = [];
  const out = new THREE.BufferGeometry();
  for (const g of groups) {
    const start = order.length;
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) if (keep(t)) order.push(t);
    if (order.length > start) out.addGroup(start * 3, (order.length - start) * 3, g.materialIndex ?? 0);
  }
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.getAttribute(name);
    const n = src.itemSize;
    const arr = new Float32Array(order.length * 3 * n);
    let o = 0;
    for (const t of order) for (let k = 0; k < 3; k++) for (let j = 0; j < n; j++) arr[o++] = src.array[(t * 3 + k) * n + j];
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}
