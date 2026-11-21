// Агент по центру главного меню: тот же рендерер воксельных тел, спокойная анимация.
// Фон — заранее отрендеренный кадр карты с CSS-размытием (без живого рендера сцены).

import * as THREE from 'three';
import { MAPS, computePose, newPoseAnim, POSE_SIZE, WEAPONS } from '../../../shared/src/index';
import { buildMapMeshes } from '../game/mapMesh';
import { VoxelBody } from '../game/voxelBody';

/** Один кадр карты для фона меню (dataURL). */
export function renderMenuBackground(width: number, height: number): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd0f0);
  scene.fog = new THREE.Fog(0xcfe6f5, 30, 110);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xb08850, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2);
  sun.position.set(30, 60, 18);
  scene.add(sun);
  const ids = Object.keys(MAPS);
  const info = MAPS[ids[Math.floor(Math.random() * ids.length)]]();
  const { group, material } = buildMapMeshes(info.map);
  scene.add(group);
  const cam = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
  // вид с базы нападения в сторону точек
  const site = info.sites[Math.floor(Math.random() * 2)];
  const v = [info.mid[0], 2.6, info.mid[1] - 6, (site.x0 + site.x1) / 2, 1.2, (site.z0 + site.z1) / 2];
  cam.position.set(v[0], v[1], v[2]);
  cam.lookAt(v[3], v[4], v[5]);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  material.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}

export class AgentView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private body: VoxelBody | null = null;
  private mat = new THREE.MeshLambertMaterial();
  private pose = new Float32Array(POSE_SIZE);
  private t = 0;
  private running = true;
  private last = performance.now();
  private dragYaw = 0;
  private dragging = false;
  private poseKind = 0;
  private poseTimer = 4;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a6a48, 1.4));
    const key = new THREE.DirectionalLight(0xfff0d6, 2.4);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc8ff, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    this.camera.position.set(0, 1.25, 5.2);
    this.camera.lookAt(0, 0.95, 0);
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.dragYaw += e.movementX * 0.01;
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  /** weapon — ключ оружия (vikhr, osa…); по умолчанию винтовка. */
  setAgent(team: number, agent: number, skin: number, weapon = 'vikhr') {
    this.body?.dispose();
    this.body = new VoxelBody(team, agent, skin, this.mat);
    const def = WEAPONS.find((w) => w.key === weapon) ?? WEAPONS.find((w) => w.key === 'vikhr')!;
    this.weaponKind = def.kind;
    this.weaponKey = def.key;
    this.body.setWeapon(def.kind, def.key);
    this.scene.add(this.body.group);
  }

  private resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.poseTimer -= dt;
    if (this.poseTimer <= 0) {
      this.poseTimer = 4 + Math.random() * 3;
      this.poseKind = (this.poseKind + 1) % 3;
    }
    if (this.body) this.animateIdle(dt);
    this.renderer.render(this.scene, this.camera);
  };

  // Спокойная анимация в меню: дыхание, перенос веса с ноги на ногу и три позы,
  // между которыми агент плавно переходит: оружие опущено, к плечу, осмотр по сторонам.
  private anim = newPoseAnim();
  private weaponKind = 'rifle';
  private weaponKey = 'vikhr';
  private cur = { pitch: -0.55, legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0, lean: 0, look: 0 };

  private animateIdle(dt: number) {
    const k = this.poseKind;
    const t = this.t;
    // перенос веса: опорная нога прямая, другая чуть согнута и выставлена
    const shift = Math.sin(t * 0.35) > 0 ? 1 : -1;
    const target = {
      pitch: k === 0 ? -0.6 : k === 1 ? -0.08 : -0.38,
      legL: shift > 0 ? 0.1 : -0.02,
      legR: shift > 0 ? -0.02 : 0.1,
      kneeL: shift > 0 ? 0.28 : 0.04,
      kneeR: shift > 0 ? 0.04 : 0.28,
      armL: 0,
      lean: k === 1 ? -0.05 : 0.02,
      // осмотр: голова смотрит по сторонам, раз в несколько секунд в другую
      look: k === 2 ? Math.sin(t * 0.9) * 0.55 : Math.sin(t * 0.23) * 0.12,
    };
    const c = this.cur;
    const r = 1 - Math.exp(-dt * 3);
    for (const key of Object.keys(c) as Array<keyof typeof c>) c[key] += (target[key] - c[key]) * r;
    const breathe = Math.sin(t * 1.6);
    const a = this.anim;
    a.crouch = 0;
    a.legL = c.legL;
    a.legR = c.legR;
    a.kneeL = c.kneeL;
    a.kneeR = c.kneeR;
    // согнутое колено опускает таз, дыхание поднимает плечи
    a.bob = -0.02 * Math.max(c.kneeL, c.kneeR) + breathe * 0.006;
    a.lean = c.lean + breathe * 0.012;
    a.armPitch = breathe * 0.02;
    a.reload = c.armL;
    a.weapon = this.weaponKind;
    a.headYaw = c.look;
    const yaw = Math.PI + 0.35 + this.dragYaw;
    computePose(0, 0, 0, yaw, c.pitch, false, this.pose, a);
    this.body!.setWeapon(this.weaponKind, this.weaponKey); // модель могла догрузиться
    this.body!.applyPose(this.pose, a);
  }

  dispose() {
    this.running = false;
    this.ro.disconnect();
    this.body?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
