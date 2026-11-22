// Стенд анимаций агентов (только для разработки): http://127.0.0.1:5173/anim.html
// Каждый агент получает синтетическое движение, как у чужого игрока в матче,
// и проходит через тот же AgentAnimator → computePose → VoxelBody, что и в игре.

import * as THREE from 'three';
import { computePose, POSE_SIZE, RUN_SPEED, CROUCH_SPEED } from '../../shared/src/index';
import { AgentAnimator } from './game/animator';
import { VoxelBody } from './game/voxelBody';
import { applyFore, loadGunModels } from './game/weaponModels';

loadGunModels();
/** вид оружия → ключ модели */
const KEY_OF: Record<string, string> = { rifle: 'vikhr', smg: 'shmel', pistol: 'osa', sniper: 'sokol', shotgun: 'molot', knife: 'knife' };

interface Actor {
  name: string;
  body: VoxelBody;
  anim: AgentAnimator;
  pose: Float32Array;
  x0: number;
  z0: number;
  /** движение: позиция, поворот и флаги в момент t */
  move: (t: number) => { x: number; y: number; z: number; yaw: number; crouch: boolean; onGround: boolean; reloading: boolean; fire: boolean; pitch: number; using?: 'plant' | 'defuse'; hold?: 'low' | 'up' };
  weapon: string;
  lastFire: number;
}

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0f0);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a6a48, 1.4));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
sun.position.set(6, 10, 4);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0xd8c39a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(80, 160, 0xb8a37a, 0xc9b58c);
grid.position.y = 0.002;
scene.add(grid);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
const mat = new THREE.MeshLambertMaterial();

// Сетка 4×3: каждый агент ходит туда-обратно вдоль X в своей клетке, камера смотрит сбоку (с +Z)
const COLS = 4;
const CELL_X = 6;
const CELL_Z = 4;
const LEN = 4;
const back = (t: number, len: number, speed: number) => {
  // туда-обратно по отрезку длиной len со скоростью speed; возвращает смещение и направление
  const T = len / speed;
  const k = t % (2 * T);
  return k < T ? { s: k * speed - len / 2, dir: 1 } : { s: len / 2 - (k - T) * speed, dir: -1 };
};
// поворот, при котором «вперёд» смотрит вдоль +X или −X
const YAW_PX = -Math.PI / 2,
  YAW_NX = Math.PI / 2,
  YAW_CAM = Math.PI; // лицом к камере
const still = (o: Partial<ReturnType<Actor['move']>> = {}) => ({ x: 0, y: 0, z: 0, yaw: YAW_CAM - 0.6, crouch: false, onGround: true, reloading: false, fire: false, pitch: 0, ...o });
type Scn = { name: string; weapon: string; move: Actor['move'] };
const scenarios: Scn[] = [
  { name: 'Стоит', weapon: 'rifle', move: () => still() },
  { name: 'Шаг', weapon: 'rifle', move: (t) => walk(t, RUN_SPEED * 0.45, false) },
  { name: 'Бег', weapon: 'rifle', move: (t) => walk(t, RUN_SPEED, false) },
  { name: 'Бег с ножом', weapon: 'knife', move: (t) => walk(t, RUN_SPEED * 1.05, false) },
  { name: 'Присед: стоит / идёт', weapon: 'smg', move: (t) => (t % 6 < 2 ? still({ crouch: true }) : walk(t, CROUCH_SPEED, true)) },
  { name: 'Встаёт и садится', weapon: 'rifle', move: (t) => still({ crouch: t % 3 < 1.5 }) },
  { name: 'Спиной вперёд', weapon: 'rifle', move: (t) => {
    const w = walk(t, RUN_SPEED * 0.7, false);
    return { ...w, yaw: w.yaw === YAW_PX ? YAW_NX : YAW_PX };
  } },
  { name: 'Вбок, лицом к нам', weapon: 'pistol', move: (t) => ({ ...walk(t, RUN_SPEED * 0.8, false), yaw: YAW_CAM }) },
  { name: 'Прыжки на бегу', weapon: 'rifle', move: (t) => jump(t) },
  { name: 'Стрельба (стоя / присев)', weapon: 'rifle', move: (t) => still({ crouch: t % 8 > 4, fire: t % 2 < 1.2, yaw: YAW_CAM - 1.2 }) },
  { name: 'Перезарядка', weapon: 'rifle', move: (t) => still({ reloading: t % 4 < 2.4, yaw: YAW_CAM - 1 }) },
  { name: 'Поворот на месте', weapon: 'rifle', move: (t) => still({ yaw: YAW_CAM + Math.sin(t * 0.9) * 1.6 }) },
  { name: 'Меню: винтовка', weapon: 'rifle', move: () => still({ hold: 'low', yaw: YAW_CAM + 0.35, pitch: -0.1 }) },
  { name: 'Меню: пистолет', weapon: 'pistol', move: () => still({ hold: 'up', yaw: YAW_CAM + 0.35, pitch: -0.1 }) },
  { name: 'Закладка бомбы', weapon: 'rifle', move: (t) => still({ using: t % 6 < 4 ? 'plant' : undefined, yaw: YAW_CAM - 1.1 }) },
  { name: 'Обезвреживание', weapon: 'pistol', move: (t) => still({ using: t % 8 < 6 ? 'defuse' : undefined, yaw: YAW_CAM - 1.1 }) },
];
function walk(t: number, speed: number, crouch: boolean) {
  const { s, dir } = back(t, LEN, speed);
  return { x: s, y: 0, z: 0, yaw: dir > 0 ? YAW_PX : YAW_NX, crouch, onGround: true, reloading: false, fire: false, pitch: 0 };
}
function jump(t: number) {
  const k = t % 1.4;
  const v = 7.1,
    g = 20;
  const y = Math.max(0, v * k - (g * k * k) / 2);
  return { ...walk(t, RUN_SPEED * 0.8, false), y, onGround: y <= 0.001 };
}

const actors: Actor[] = [];
let team = 0;
function build() {
  for (const a of actors) a.body.dispose();
  actors.length = 0;
  scenarios.forEach((s, i) => {
    const body = new VoxelBody(team, 0, 0, mat);
    body.setWeapon(s.weapon);
    scene.add(body.group);
    const col = i % COLS,
      row = Math.floor(i / COLS);
    actors.push({ name: s.name, body, anim: new AgentAnimator(), pose: new Float32Array(POSE_SIZE), x0: (col - (COLS - 1) / 2) * CELL_X, z0: -row * CELL_Z, move: s.move, weapon: s.weapon, lastFire: 0 });
  });
}
build();

// Подписи
const labels: HTMLDivElement[] = [];
for (const s of scenarios) {
  const d = document.createElement('div');
  d.textContent = s.name;
  d.style.cssText = 'position:fixed;color:#111;background:rgba(255,255,255,.7);padding:1px 5px;transform:translate(-50%,0);pointer-events:none;white-space:nowrap';
  document.body.appendChild(d);
  labels.push(d);
}

// Кнопки
const ui = document.getElementById('ui')!;
let speedMul = 1;
let slowMo = false;
const btn = (text: string, on: () => void) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = () => on();
  ui.appendChild(b);
  return b;
};
const teamBtn = btn('Сторона: нападение', () => {
  team = 1 - team;
  teamBtn.textContent = team ? 'Сторона: защита' : 'Сторона: нападение';
  build();
});
const slowBtn = btn('Замедление ×0.25', () => {
  slowMo = !slowMo;
  speedMul = slowMo ? 0.25 : 1;
  slowBtn.classList.toggle('on', slowMo);
});
let paused = false;
const pauseBtn = btn('Пауза', () => {
  paused = !paused;
  pauseBtn.classList.toggle('on', paused);
});
// приблизить камеру к одному агенту
let focus = Number(new URLSearchParams(location.search).get('focus') ?? -1);
const focusBtns: HTMLButtonElement[] = [];
const setFocus = (i: number) => {
  focus = i;
  camDist = i < 0 ? 26 : 6;
  focusBtns.forEach((b, k) => b.classList.toggle('on', k - 1 === i));
};
focusBtns.push(btn('Все', () => setFocus(-1)));
scenarios.forEach((s, i) => focusBtns.push(btn(s.name, () => setFocus(i))));

// Камера: вращение мышью, приближение колесом
// ?yaw=1.2&pitch=0.2 — угол камеры (для снимков)
const qs = new URLSearchParams(location.search);
let camYaw = Number(qs.get('yaw') ?? 0),
  camPitch = Number(qs.get('pitch') ?? 0.32),
  camDist = 26;
let drag = false;
canvas.addEventListener('pointerdown', () => (drag = true));
addEventListener('pointerup', () => (drag = false));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  camYaw -= e.movementX * 0.006;
  camPitch = Math.max(0.02, Math.min(1.4, camPitch + e.movementY * 0.004));
});
canvas.addEventListener('wheel', (e) => {
  camDist = Math.max(3, Math.min(60, camDist * (e.deltaY > 0 ? 1.1 : 0.9)));
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let t = 0;
let last = performance.now();
const v = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = paused ? 0 : (Math.min(0.1, (now - last) / 1000) * speedMul);
  last = now;
  t += dt;
  const fa = actors[focus];
  const target = fa ? new THREE.Vector3(fa.x0, 0.9, fa.z0) : new THREE.Vector3(0, 0.9, -CELL_Z);
  camera.position.set(target.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, target.y + Math.sin(camPitch) * camDist, target.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
  camera.lookAt(target);
  actors.forEach((a, i) => {
    const m = a.move(t);
    const x = a.x0 + m.x,
      z = a.z0 + m.z;
    if (m.fire && t - a.lastFire > 0.12) {
      a.lastFire = t;
      a.anim.fire(a.weapon);
    }
    if (dt > 0) {
      const an = a.anim.update(dt, { x, y: m.y, z, yaw: m.yaw, crouch: m.crouch, onGround: m.onGround, reloading: m.reloading, weaponKind: a.weapon, using: !!m.using });
      applyFore(an, KEY_OF[a.weapon]);
      an.hold = m.hold;
      computePose(x, m.y, z, m.yaw, m.pitch, m.crouch, a.pose, an);
      if (an.use > 0.5) a.body.setWeapon(m.using === 'plant' ? 'bomb' : 'none');
      else a.body.setWeapon(a.weapon, KEY_OF[a.weapon]);
      a.body.applyPose(a.pose, an);
    }
    v.set(a.x0, 2.3, a.z0).project(camera);
    labels[i].style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    labels[i].style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  });
  renderer.render(scene, camera);
}
setFocus(focus);
requestAnimationFrame(frame);
