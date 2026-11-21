// Стенд оружия (только для разработки): http://127.0.0.1:5173/weapons.html — модели так, как их видит игра;
// ?only=Pistol_02,Pistol_03 — исходники пака (для замера точек хвата)
// Модели из public/models/_candidates: вид сбоку, дуло вправо (−Z), линейка по 10% длины
// (0 — затыльник/приклад слева, 100% — дуло справа) и по 10% высоты (0 — низ).

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { cloneGun, gunModel, loadGunModels, onGunModel } from './game/weaponModels';

const ALL = ['AssaultRifle_01', 'AssaultRifle_02', 'AssaultRifle_03', 'Pistol_01', 'Pistol_02', 'Pistol_03', 'Revolver_01', 'Revolver_02', 'Shotgun_01', 'Shotgun_03', 'SniperRifle_01', 'SniperRifle_02', 'SubmachineGun_01', 'SubmachineGun_02', 'SubmachineGun_03', 'SubmachineGun_04', 'SubmachineGun_05'];
const only = new URLSearchParams(location.search).get('only');
const NAMES = only ? only.split(',') : ALL;
// ?game=1 — модели так, как их получает игра: дуло −Z, начало — в рукояти, точки хвата отмечены
const GAME = !only; // по умолчанию — модели из игры; ?only=… — исходники из public/models/_candidates (скопировать вручную)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0xdbe8f0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a68, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(8, 5, 3);
scene.add(sun);
// камера на +X смотрит на начало: экран вправо = −Z (дуло), вверх = +Y
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(20, 0, 0);
camera.lookAt(0, 0, 0);
const LEN = 10;
const ROW = only ? 5.5 : 4;
const labels: Array<() => void> = [];
const lineMat =new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.45 });

function line(a: THREE.Vector3, b: THREE.Vector3) {
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat));
}

if (GAME) {
  const keys = ['osa', 'gyurza', 'shmel', 'molot', 'vikhr', 'sokol'];
  loadGunModels();
  const dot = (color: number, p: THREE.Vector3, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.02), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 10;
    parent.add(m);
  };
  onGunModel(() => {
    keys.forEach((key, i) => {
      const gm = gunModel(key);
      if (!gm || scene.getObjectByName(key)) return;
      const g = cloneGun(key)!;
      g.name = key;
      // ряды по 0,45 м, ось ствола — горизонтально
      g.position.set(0, 1.1 - i * 0.45, 0);
      dot(0x22cc44, new THREE.Vector3(), g);
      if (gm.fore) dot(0x2266ff, gm.fore, g);
      dot(0xffcc00, gm.muzzle, g);
      scene.add(g);
      const label = document.createElement('div');
      label.textContent = key;
      label.style.cssText = 'position:fixed;font-weight:600;background:#fffc;padding:1px 4px';
      document.body.appendChild(label);
      labels.push(() => {
        const v = new THREE.Vector3(0, 1.1 - i * 0.45 + 0.12, 0.45).project(camera);
        label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
        label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      });
    });
  });
}

(GAME ? [] : NAMES).forEach((name, i) => {
  const y0 = -i * ROW + ((NAMES.length - 1) * ROW) / 2;
  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = 'position:fixed;font-weight:600;background:#fffc;padding:1px 4px';
  document.body.appendChild(label);
  labels.push(() => {
    const v = new THREE.Vector3(0, y0, LEN / 2 + 1).project(camera);
    label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth - label.offsetWidth}px`;
    label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight - 8}px`;
  });
  new MTLLoader().setPath('/models/_candidates/').load(`${name}.mtl`, (mtl) => {
    mtl.preload();
    new OBJLoader()
      .setMaterials(mtl)
      .setPath('/models/_candidates/')
      .load(`${name}.obj`, (obj) => {
        const box0 = new THREE.Box3().setFromObject(obj);
        const s0 = box0.getSize(new THREE.Vector3());
        const holder = new THREE.Group();
        holder.add(obj);
        // длинная ось — вдоль Z
        if (s0.x > s0.z) obj.rotation.y = Math.PI / 2;
        holder.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(holder);
        const k = LEN / box.getSize(new THREE.Vector3()).z;
        obj.scale.setScalar(k);
        holder.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(holder);
        // низ в y0 − h/2, затыльник (+Z) слева в z = LEN/2
        const size = box.getSize(new THREE.Vector3());
        obj.position.set(-(box.min.x + box.max.x) / 2, y0 - size.y / 2 - box.min.y, LEN / 2 - box.max.z);
        scene.add(holder);
        const bottom = y0 - size.y / 2,
          top = y0 + size.y / 2;
        for (let t = 0; t <= 10; t++) line(new THREE.Vector3(1, bottom - 0.2, LEN / 2 - t), new THREE.Vector3(1, top + 0.2, LEN / 2 - t));
        for (let t = 0; t <= 10; t++) {
          const y = bottom + (size.y * t) / 10;
          line(new THREE.Vector3(1, y, LEN / 2 + 0.2), new THREE.Vector3(1, y, -LEN / 2 - 0.2));
        }
        label.textContent = `${name}  (высота/длина ${(size.y / LEN).toFixed(2)})`;
      });
  });
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  const h = GAME ? 1.5 : (NAMES.length * ROW) / 2 + 0.5;
  camera.left = -h * aspect;
  camera.right = h * aspect;
  camera.top = h;
  camera.bottom = -h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
function frame() {
  requestAnimationFrame(frame);
  for (const l of labels) l();
  renderer.render(scene, camera);
}
frame();
