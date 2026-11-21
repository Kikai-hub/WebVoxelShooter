// Агент по центру главного меню: тот же рендерер воксельных тел, спокойная анимация.
// Фон — заранее отрендеренный кадр карты с CSS-размытием (без живого рендера сцены).

import * as THREE from 'three';
import { MAPS, computePose, POSE_SIZE } from '../../../shared/src/index';
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

  setAgent(team: number, agent: number, skin: number, weaponKind = 'rifle') {
    this.body?.dispose();
    this.body = new VoxelBody(team, agent, skin, this.mat);
    this.body.setWeapon(weaponKind);
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
    if (this.body) {
      // дыхание и смена позы: оружие вниз, к плечу, осмотр
      const breathe = Math.sin(this.t * 1.6) * 0.015;
      const pitch = this.poseKind === 0 ? -0.55 : this.poseKind === 1 ? -0.1 + breathe : -0.35;
      const yaw = Math.PI + 0.35 + this.dragYaw + (this.poseKind === 2 ? Math.sin(this.t * 0.8) * 0.25 : 0);
      computePose(0, breathe, 0, yaw, pitch, false, this.pose);
      this.body.applyPose(this.pose);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.running = false;
    this.ro.disconnect();
    this.body?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
