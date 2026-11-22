// Картинки предметов для инвентаря: настоящие 3D-модели, отрендеренные в цвете на прозрачном фоне
// (оружие — в три четверти, дулом вправо; агенты — в полный рост). Один общий WebGL-рендерер,
// готовые картинки кэшируются как data URL. Нож и гранаты моделей не имеют — для них блочные модели.

import * as THREE from 'three';
import { computePose, newPoseAnim, POSE_SIZE, SKINS, WEAPONS } from '../../../shared/src/index';
import { buildGun } from '../game/viewmodel';
import { VoxelBody } from '../game/voxelBody';
import { gunModel } from '../game/weaponModels';

const W = 320,
  H = 200;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function scene(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xe6f0ff, 0x6a5a48, 1.7));
  const key = new THREE.DirectionalLight(0xfff2dc, 2.6);
  key.position.set(2, 3, 4);
  s.add(key);
  const rim = new THREE.DirectionalLight(0xa8c8ff, 1.4);
  rim.position.set(-3, 2, -3);
  s.add(rim);
  return s;
}

function render(s: THREE.Scene, cam: THREE.Camera, w: number, h: number): string | null {
  try {
    renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.render(s, cam);
  return renderer.domElement.toDataURL('image/png');
}

/** Оружие в три четверти: дуло вправо, чуть сверху. null — модель ещё грузится. */
export function weaponRender(key: string, skin = 0, team = 1): string | null {
  const id = `w:${key}:${skin}:${team}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const def = WEAPONS.find((w) => w.key === key);
  if (!def) return null;
  const hasModel = !!gunModel(key);
  // у стволов из пака модель грузится в фоне — без неё не рендерим (вернёмся, когда загрузится)
  if (!hasModel && def.kind !== 'knife' && def.kind !== 'grenade') return null;
  const g = buildGun(def, SKINS[skin]?.tint ?? 0xffffff, team);
  const s = scene();
  const holder = new THREE.Group();
  holder.add(g);
  // дуло (−Z) вправо и немного к зрителю
  holder.rotation.set(0.12, -Math.PI / 2 + 0.38, 0.06);
  s.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const aspect = W / H;
  const halfW = Math.max(size.x / 2, (size.y / 2) * aspect) * 1.12 + 0.01;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfW / aspect, -halfW / aspect, 0.01, 20);
  cam.position.set(c.x, c.y, c.z + 5);
  cam.lookAt(c);
  const url = render(s, cam, W, H);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // геометрия моделей общая с шаблоном (cloneGun) — освобождаем только свою (блочную)
    if (m.isMesh && !hasModel) {
      m.geometry.dispose();
      if (def.kind === 'knife') (m.material as THREE.Material).dispose();
    }
  });
  if (url) cache.set(id, url);
  return url;
}

const agentMat = new THREE.MeshLambertMaterial();

/** Агент в полный рост, лицом к зрителю, с винтовкой в опущенных руках. */
export function agentRender(team: number, agent: number, skin = 0): string | null {
  const id = `a:${team}:${agent}:${skin}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const body = new VoxelBody(team, agent, skin, agentMat);
  const pose = new Float32Array(POSE_SIZE);
  const an = newPoseAnim();
  an.weapon = 'rifle';
  an.hold = 'low';
  computePose(0, 0, 0, Math.PI + 0.3, -0.3, false, pose, an);
  body.applyPose(pose, an);
  body.setWeapon('rifle', team === 0 ? 'vikhr' : 'm4a1');
  const s = scene();
  s.add(body.group);
  const cam = new THREE.PerspectiveCamera(24, 0.72, 0.1, 30);
  cam.position.set(0, 1.0, 4.9);
  cam.lookAt(0, 0.93, 0);
  const url = render(s, cam, 180, 250);
  body.dispose();
  if (url) cache.set(id, url);
  return url;
}
