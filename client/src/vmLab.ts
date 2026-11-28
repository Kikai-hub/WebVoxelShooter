// Стенд анимаций оружия от первого лица (только для разработки): http://127.0.0.1:5173/anim.html?vm=1
// Та же ViewModel, что в игре: доставание, перезарядка (со щелчками из той же таблицы), удары ножом, осмотр.
// Параметры для снимков: ?vm=1&w=vikhr&a=reload&k=0.3&team=0 — оружие, анимация, доля времени (замороженный кадр).

import * as THREE from 'three';
import { DRAW_TIME, WEAPONS } from '../../shared/src/index';
import { ViewModel, type VmLabAnim } from './game/viewmodel';
import { loadGunModels } from './game/weaponModels';
import { Sfx } from './game/audio';

loadGunModels();
const qs = new URLSearchParams(location.search);

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.autoClear = false;
// фон — простая «стена» и пол, чтобы было видно положение рук
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8c8);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xb9a57e }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.6;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 100);

const vm = new ViewModel(0);
(window as unknown as { vm: ViewModel }).vm = vm; // для отладки из консоли
const sfx = new Sfx();
let team = Number(qs.get('team') ?? 1);
vm.setTeam(team);

const ui = document.getElementById('ui')!;
const btn = (text: string, on: () => void, parent: HTMLElement = ui) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = () => on();
  parent.appendChild(b);
  return b;
};
const row = () => {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;width:100%';
  ui.appendChild(d);
  return d;
};

// оружие
const list = WEAPONS.filter((w) => w);
let weapon = list.find((w) => w.key === qs.get('w')) ?? list.find((w) => w.key === 'vikhr') ?? list[0];
const wRow = row();
const wBtns = list.map((w) =>
  btn(
    w.name,
    () => {
      weapon = w;
      vm.setWeapon(w.id);
      wBtns.forEach((b, i) => b.classList.toggle('on', list[i] === w));
      play('draw');
    },
    wRow,
  ),
);
wBtns.forEach((b, i) => b.classList.toggle('on', list[i] === weapon));
vm.setWeapon(weapon.id);

// действия
let speedMul = 1;
let frozen: { anim: VmLabAnim; k: number } | null = qs.get('a') ? { anim: qs.get('a') as VmLabAnim, k: Number(qs.get('k') ?? 0.5) } : null;
const aRow = row();
const play = (a: VmLabAnim) => {
  frozen = null;
  vm.lab = null;
  if (a === 'draw') {
    // повторная смена на то же оружие ничего не делает — через «пустое»
    vm.setWeapon(-1);
    vm.setWeapon(weapon.id);
  } else if (a === 'reload') {
    vm.reload(weapon.reload / speedMul);
    if (weapon.kind !== 'knife' && weapon.kind !== 'grenade') sfx.reload(weapon.kind, weapon.key, weapon.reload / speedMul, 0, 0, true);
  } else if (a === 'swing') {
    vm.fire();
    sfx.shot(weapon.kind, 0, 0, weapon.key);
  } else if (a === 'inspect') vm.inspect();
};
btn('Достать', () => play('draw'), aRow);
btn('Перезарядка (R)', () => play('reload'), aRow);
btn('Выстрел / удар (ЛКМ)', () => play('swing'), aRow);
btn('Осмотр (F)', () => play('inspect'), aRow);
const teamBtn = btn(team ? 'Сторона: защита' : 'Сторона: нападение', () => {
  team = 1 - team;
  vm.setTeam(team);
  teamBtn.textContent = team ? 'Сторона: защита' : 'Сторона: нападение';
}, aRow);
const slowBtn = btn('Замедление ×0.25', () => {
  speedMul = speedMul === 1 ? 0.25 : 1;
  slowBtn.classList.toggle('on', speedMul !== 1);
}, aRow);
let helper: THREE.Box3Helper | null = null;
let showBox = qs.has('box');
const boxBtn = btn('Рамка магазина', () => {
  showBox = !showBox;
  boxBtn.classList.toggle('on', showBox);
}, aRow);
boxBtn.classList.toggle('on', showBox);
btn('← Агенты', () => (location.href = 'anim.html'), aRow);

// кадр: анимация и доля времени ползунком
const fRow = row();
const sel = document.createElement('select');
for (const a of ['draw', 'reload', 'swing', 'swing2', 'inspect']) sel.add(new Option(a, a));
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0';
slider.max = '1';
slider.step = '0.005';
slider.style.width = '260px';
const out = document.createElement('span');
out.style.cssText = 'color:#123;align-self:center';
fRow.append(sel, slider, out);
const syncFrozen = () => {
  frozen = { anim: sel.value as VmLabAnim, k: Number(slider.value) };
};
sel.onchange = syncFrozen;
slider.oninput = syncFrozen;
if (frozen) {
  sel.value = frozen.anim ?? 'reload';
  slider.value = String(frozen.k);
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') play('reload');
  if (e.code === 'KeyF') play('inspect');
  if (e.code === 'Space') play('swing');
});
canvas.addEventListener('pointerdown', () => play('swing'));

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  step();
}
/** Один кадр; из консоли — window.labStep() (фоновая вкладка не получает requestAnimationFrame). */
function step() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000) * speedMul;
  last = now;
  vm.lab = frozen;
  out.textContent = frozen
    ? `${frozen.anim} k=${frozen.k.toFixed(3)}` + (frozen.anim === 'reload' ? ` (${(frozen.k * weapon.reload).toFixed(2)} с из ${weapon.reload})` : frozen.anim === 'draw' ? ` (${(frozen.k * DRAW_TIME).toFixed(2)} с)` : '')
    : 'живое воспроизведение';
  // рамка вырезаемого объёма магазина — на оружии в руках
  const lr = vm.labRig;
  if (helper && (!showBox || helper.parent !== lr?.gun)) {
    helper.removeFromParent();
    helper = null;
  }
  if (showBox && !helper && lr?.box) {
    helper = new THREE.Box3Helper(lr.box, 0xff2050);
    lr.gun.add(helper);
  }
  vm.update(dt, 0, innerWidth / innerHeight, true, false);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vm.scene, vm.camera);
}
requestAnimationFrame(frame);
(window as unknown as { labStep: () => void }).labStep = step;
