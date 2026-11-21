// Силуэты оружия для ленты убийств: стволы — из 3D-моделей (вид сбоку, дуло вправо, белым),
// нож и гранаты — нарисованы на канвасе. Плюс значки: попадание в голову, голова вдребезги, взрыв бомбы.
// Готовые картинки кэшируются как data URL; пока модель не загрузилась — null (лента покажет название).

import * as THREE from 'three';
import { gunModel, onGunModel } from './weaponModels';

const ICON_H = 44; // высота картинки, px (в ленте ужимается до ~18 px по высоте)
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

function gunIcon(key: string): string | null {
  const m = gunModel(key);
  if (!m) return null;
  try {
    renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  const g = m.template.clone(true);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = white;
  });
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // вид сбоку справа: дуло (−Z) смотрит вправо
  const halfW = size.z / 2 + 0.01,
    halfH = size.y / 2 + 0.01;
  const w = Math.max(24, Math.round((ICON_H * halfW) / halfH));
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 10);
  cam.position.set(c.x + 3, c.y, c.z);
  cam.lookAt(c);
  const scene = new THREE.Scene();
  scene.add(g);
  renderer.setPixelRatio(1);
  renderer.setSize(Math.min(w, 220), ICON_H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}

/** Нарисовать значок на 2D-канвасе (белым по прозрачному). */
function drawn(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  paint(g);
  return c.toDataURL('image/png');
}

const DRAWN: Record<string, () => string> = {
  knife: () =>
    drawn(96, ICON_H, (g) => {
      // рукоять слева, клинок вправо, острие вверх-вправо
      g.fillRect(4, 22, 28, 10);
      g.fillRect(30, 17, 5, 20);
      g.beginPath();
      g.moveTo(35, 20);
      g.lineTo(80, 20);
      g.quadraticCurveTo(92, 22, 94, 27);
      g.quadraticCurveTo(70, 33, 35, 32);
      g.closePath();
      g.fill();
    }),
  he: () =>
    drawn(40, ICON_H, (g) => {
      g.beginPath();
      g.ellipse(18, 28, 13, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(12, 9, 12, 7); // запал
      g.fillRect(24, 11, 12, 4); // скоба
      g.beginPath();
      g.arc(30, 8, 4, 0, Math.PI * 2);
      g.lineWidth = 2.5;
      g.stroke();
    }),
  flash: () =>
    drawn(34, ICON_H, (g) => {
      g.fillRect(7, 14, 20, 28);
      g.fillRect(11, 6, 12, 8);
      g.fillRect(23, 8, 9, 3);
    }),
  smoke: () =>
    drawn(34, ICON_H, (g) => {
      g.fillRect(6, 12, 22, 30);
      g.fillRect(10, 5, 14, 7);
      g.clearRect(6, 22, 22, 2);
      g.clearRect(6, 31, 22, 2);
    }),
  molotov: () =>
    drawn(30, ICON_H, (g) => {
      g.beginPath();
      g.moveTo(8, 42);
      g.lineTo(8, 22);
      g.quadraticCurveTo(8, 16, 12, 14);
      g.lineTo(12, 7);
      g.lineTo(18, 7);
      g.lineTo(18, 14);
      g.quadraticCurveTo(22, 16, 22, 22);
      g.lineTo(22, 42);
      g.closePath();
      g.fill();
      g.beginPath(); // фитиль-пламя
      g.moveTo(15, 7);
      g.quadraticCurveTo(10, 2, 15, 0);
      g.quadraticCurveTo(20, 2, 15, 7);
      g.fill();
    }),
  incgrenade: () =>
    drawn(34, ICON_H, (g) => {
      g.fillRect(7, 14, 20, 28);
      g.fillRect(11, 6, 12, 8);
      g.fillRect(23, 8, 9, 3);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); // язычок пламени на корпусе
      g.moveTo(17, 37);
      g.quadraticCurveTo(10, 30, 16, 20);
      g.quadraticCurveTo(24, 30, 17, 37);
      g.fill();
    }),
  // голова в профиль с отверстием — убийство в голову
  headshot: () =>
    drawn(34, ICON_H, (g) => {
      g.beginPath();
      g.arc(17, 18, 11, 0, Math.PI * 2);
      g.fill();
      g.fillRect(11, 26, 12, 9); // шея
      g.beginPath();
      g.moveTo(2, 44);
      g.quadraticCurveTo(4, 33, 17, 33);
      g.quadraticCurveTo(30, 33, 32, 44);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(13, 16, 3.5, 0, Math.PI * 2);
      g.fill();
    }),
  // голова разлетелась на кубики
  explode: () =>
    drawn(40, ICON_H, (g) => {
      g.fillRect(14, 28, 12, 7);
      g.beginPath();
      g.moveTo(4, 44);
      g.quadraticCurveTo(6, 33, 20, 33);
      g.quadraticCurveTo(34, 33, 36, 44);
      g.fill();
      for (const [x, y, s] of [
        [8, 10, 6],
        [18, 4, 7],
        [29, 9, 6],
        [12, 20, 5],
        [25, 19, 6],
        [3, 22, 4],
        [34, 22, 4],
      ])
        g.fillRect(x, y, s, s);
    }),
  // взрыв бомбы (убийца — «мир»)
  bomb: () =>
    drawn(40, ICON_H, (g) => {
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2,
          r = i % 2 ? 9 : 19;
        g.lineTo(20 + Math.cos(a) * r, 22 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }),
};

/** Картинка-силуэт для оружия или значка (data URL) или null, если ещё не готова. */
export function weaponIcon(key: string): string | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const make = DRAWN[key];
  const url = make ? make() : gunIcon(key);
  if (url) cache.set(key, url);
  return url;
}

/** Модели догружаются — сбрасывать нечего: промахи кэша просто повторятся при следующем убийстве. */
onGunModel(() => {});
