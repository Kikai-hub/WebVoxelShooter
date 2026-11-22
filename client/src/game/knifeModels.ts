// Ножи: два своих варианта вместо блочного. Защита — штык-нож (прямой клинок с обратным скосом
// обуха, гарда, рифлёная рукоять), нападение — керамбит (серповидный клинок, кольцо на хвостовике).
// Контуры строятся 2D-фигурами и выдавливаются в толщину. Система координат — как у остального
// оружия: клинок вперёд вдоль −Z, начало — у гарды (кисть держит рукоять позади, +Z).

import * as THREE from 'three';

export type KnifeKind = 'bayonet' | 'karambit';
/** Сторона → нож: 0 — нападение (керамбит), 1 — защита (штык-нож). */
export const KNIFE_OF_TEAM: [KnifeKind, KnifeKind] = ['karambit', 'bayonet'];
export const KNIFE_NAMES: Record<KnifeKind, string> = { bayonet: 'Штык-нож', karambit: 'Керамбит' };

const steel = (tint: THREE.Color) => new THREE.MeshPhongMaterial({ color: new THREE.Color(0xd4d9df).multiply(tint), specular: 0xffffff, shininess: 90 });
const edge = () => new THREE.MeshPhongMaterial({ color: 0xf2f5f8, specular: 0xffffff, shininess: 140 });
const dark = (c: number) => new THREE.MeshPhongMaterial({ color: c, specular: 0x333333, shininess: 20 });

/**
 * Профиль в плоскости (u — вперёд по клинку, v — вверх) → выдавленная деталь толщиной t.
 * u переводится в −Z, толщина — по X (по центру).
 */
function part(shape: THREE.Shape, t: number, mat: THREE.Material, bevel = 0): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -t / 2);
  g.rotateY(Math.PI / 2); // x (u) → −z, z (толщина) → x
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function bayonet(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  // клинок: прямой обух, у острия — обратный скос; лезвие поднимается к острию
  const b = new THREE.Shape();
  b.moveTo(0, 0.013);
  b.lineTo(0.15, 0.013);
  b.lineTo(0.205, 0.004); // скос обуха
  b.lineTo(0.235, -0.001); // острие
  b.quadraticCurveTo(0.2, -0.016, 0.14, -0.019);
  b.lineTo(0, -0.019);
  b.closePath();
  g.add(part(b, 0.0045, steel(tint), 0.0008));
  // заточка — светлая полоса вдоль лезвия
  const e = new THREE.Shape();
  e.moveTo(0.01, -0.014);
  e.lineTo(0.14, -0.014);
  e.quadraticCurveTo(0.2, -0.011, 0.233, -0.0015);
  e.quadraticCurveTo(0.2, -0.0165, 0.14, -0.0195);
  e.lineTo(0.01, -0.0195);
  e.closePath();
  g.add(part(e, 0.0052, edge()));
  // дол (тёмная канавка) у обуха
  const f = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.004, 0.1), dark(0x6d737a));
  f.position.set(0, 0.006, -0.07);
  g.add(f);
  // гарда
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.06, 0.008), dark(0x2a2c2e));
  guard.position.set(0, -0.003, 0.002);
  g.add(guard);
  // рукоять: оливковая, с рифлением, и навершие
  const h = new THREE.Shape();
  h.moveTo(0, 0.012);
  h.lineTo(0.105, 0.014);
  h.quadraticCurveTo(0.118, 0.012, 0.118, 0);
  h.lineTo(0.118, -0.018);
  h.lineTo(0, -0.02);
  h.closePath();
  const handle = part(h, 0.022, dark(0x4c5536), 0.002);
  handle.scale.z = -1; // рукоять — назад (+Z)
  g.add(handle);
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.036, 0.004), dark(0x3a4129));
    r.position.set(0, -0.003, 0.02 + i * 0.015);
    g.add(r);
  }
  const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.036, 0.012), dark(0x2a2c2e));
  pommel.position.set(0, -0.003, 0.124);
  g.add(pommel);
  return g;
}

function karambit(tint: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  // клинок — серп, загнутый вниз; заточка по внутренней (вогнутой) стороне
  const b = new THREE.Shape();
  b.moveTo(0, 0.014);
  b.quadraticCurveTo(0.1, 0.022, 0.15, -0.035); // обух выгибается и уходит вниз к острию
  b.lineTo(0.152, -0.06); // острие
  b.quadraticCurveTo(0.112, -0.012, 0.05, -0.008); // вогнутое лезвие
  b.quadraticCurveTo(0.02, -0.008, 0, -0.012);
  b.closePath();
  g.add(part(b, 0.005, steel(tint), 0.0008));
  const e = new THREE.Shape();
  e.moveTo(0.05, -0.0035);
  e.quadraticCurveTo(0.112, -0.007, 0.15, -0.056);
  e.lineTo(0.152, -0.06);
  e.quadraticCurveTo(0.112, -0.012, 0.05, -0.008);
  e.closePath();
  g.add(part(e, 0.0058, edge()));
  // рукоять — изогнутая, чёрная с накладками
  const h = new THREE.Shape();
  h.moveTo(0, 0.016);
  h.quadraticCurveTo(0.05, 0.022, 0.085, 0.01);
  h.lineTo(0.09, -0.012);
  h.quadraticCurveTo(0.05, -0.006, 0, -0.016);
  h.closePath();
  const handle = part(h, 0.022, dark(0x1c1d20), 0.002);
  handle.scale.z = -1;
  g.add(handle);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.008, 0.012), dark(0x5a3a22));
    s.position.set(0, 0.0, 0.018 + i * 0.022);
    g.add(s);
  }
  // кольцо на хвостовике
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0055, 8, 20), new THREE.MeshPhongMaterial({ color: new THREE.Color(0x9aa1a8).multiply(tint), specular: 0xffffff, shininess: 70 }));
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0, 0.006, 0.105);
  g.add(ring);
  return g;
}

/** Модель ножа; tint — раскраска (умножает цвет стали). */
export function makeKnife(kind: KnifeKind, tint = 0xffffff): THREE.Group {
  const t = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45);
  return kind === 'karambit' ? karambit(t) : bayonet(t);
}

/** Освободить геометрию и материалы ножа. */
export function disposeKnife(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
}
