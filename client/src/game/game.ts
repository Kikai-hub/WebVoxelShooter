// Игровой клиент: сеть, предсказание своего движения, интерполяция чужих,
// рендер карты и воксельных тел, раны, разлёт головы, рэгдоллы, трассеры, HUD.

import * as THREE from 'three';
import {
  BTN_BACK,
  BTN_CROUCH,
  BTN_FIRE,
  BTN_FWD,
  BTN_JUMP,
  BTN_LEFT,
  BTN_RELOAD,
  BTN_DROP,
  SMOKE_TIME,
  FIRE_RADIUS,
  FIRE_TIME,
  BTN_RIGHT,
  BTN_USE,
  DEFUSE_TIME,
  DEFUSE_TIME_KIT,
  DT,
  INTERP_DELAY,
  MAPS,
  MAP_LIST,
  SUB_SIZE,
  chipFromArray,
  PLANT_TIME,
  POSE_SIZE,
  RUN_SPEED,
  SF_ALIVE,
  SF_CROUCH,
  SF_ONGROUND,
  SF_RELOADING,
  SF_USING,
  SLOT_KNIFE,
  SLOT_PISTOL,
  defaultBinds,
  keyLabel,
  sanitizeBinds,
  type Action,
  type Binds,
  OT_MONEY,
  HALF_ROUNDS,
  type GameMode,
  overtimeOf,
  swapsSidesBefore,
  winTarget,
  SLOT_PRIMARY,
  TICK_RATE,
  WEAPONS,
  computePose,
  copyPState,
  decodeSnapshot,
  encodeCmds,
  eyeHeight,
  inRect,
  newBodyHit,
  newMapHit,
  newPState,
  raycastBody,
  raycastMap,
  shotDirection,
  stepPlayer,
  viewDirection,
  type FullState,
  type GameEvent,
  type MapInfo,
  type OwnState,
  type PState,
  type PublicPlayer,
  type RoomState,
  type ServerMsg,
  type Snapshot,
  type UserCmd,
} from '../../../shared/src/index';
import type { AccountInfo, Settings } from '../api';
import { getToken } from '../api';
import { Sfx } from './audio';
import { Debris } from './debris';
import { ImpactMarks, Tracers } from './effects';
import { Hud, TEAM_LABEL, slotList } from './hud';
import { AgentAnimator } from './animator';
import { applyFore } from './weaponModels';
import { MapRenderer } from './mapMesh';
import { MAT_COLORS } from './atlas';
import { Ragdoll } from './ragdoll';
import { ViewModel } from './viewmodel';
import { DropsView, FireView, NadeView, SmokeView } from './nades';
import { VoxelBody } from './voxelBody';

interface Snap {
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
}

interface CPlayer {
  id: number;
  body: VoxelBody | null;
  snaps: Snap[];
  lastTick: number;
  dead: boolean;
  stepAcc: number;
  lastPos: [number, number, number];
  renderPos: [number, number, number];
  renderYaw: number;
  renderPitch: number;
  renderCrouch: boolean;
  /** сглаженная скорость на экране — для покачивания оружия у наблюдателя */
  renderSpeed: number;
  /** анимация тела (шаг, присед, прыжок, отдача, перезарядка) — только картинка */
  anim: AgentAnimator;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private vm: ViewModel;
  private info: MapInfo;
  private bodyMat = new THREE.MeshLambertMaterial();
  private debris: Debris;
  private tracers = new Tracers();
  private impacts = new ImpactMarks();
  /** копоть от взрывов: полупрозрачные пятна */
  private scorch = new ImpactMarks(160, 0x140e0a, 0.55);
  private sfx = new Sfx();
  private hud: Hud;
  private ws: WebSocket | null = null;
  private wrap: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private bombMesh: THREE.Mesh;
  private bombLight: THREE.PointLight;

  // состояние комнаты
  private myId = -1;
  private myTeam = -1;
  private spectator = true;
  private money = 0;
  private queue = 0;
  private st: RoomState | null = null;
  private players = new Map<number, CPlayer>();
  private own: OwnState | null = null;
  private latestTick = 0;

  // предсказание
  private pred: PState = newPState();
  private prevPred: PState = newPState();
  private tmpState: PState = newPState();
  private pending: UserCmd[] = [];
  private seq = 0;
  private predAlive = false;
  private canMove = false;
  private errOffset = new THREE.Vector3();
  private simTime = 0;
  private localNextFire = 0;
  private localRecoil = 0;
  private lastButtons = 0;
  private sentCmds: UserCmd[] = [];

  // время
  private clockOffset: number | null = null;
  private accum = 0;
  private lastFrame = performance.now();
  private ping = 0;
  private pingTimer = 0;
  private fpsAvg = 16;
  private resScale = 1;
  private resTimer = 0;
  private running = true;

  // ввод
  private keys = new Set<string>();
  /** нажатые и уже отпущенные между тиками клавиши — тоже попадают в ближайший тик */
  private tapped = new Set<string>();
  private fireTap = false;
  private mouseDown = false;
  private rightDown = false;
  private yaw = 0;
  private pitch = 0;
  private slot = SLOT_PISTOL;
  private lastSlot = SLOT_PRIMARY;
  private boardOpen = false;
  private buyOpen = false;
  private specTarget = -1;
  private settings: Settings;
  /** управление: действие → клавиши (из настроек аккаунта) */
  private binds: Binds = defaultBinds();
  private bound(code: string, a: Action): boolean {
    return this.binds[a]?.includes(code) ?? false;
  }
  private held(a: Action): boolean {
    return this.binds[a]?.some((c) => this.keys.has(c) || this.tapped.has(c)) ?? false;
  }
  private bombBeepAt = 0;
  private pose = new Float32Array(POSE_SIZE);
  private mapHit = newMapHit();
  private bodyHit = newBodyHit();
  private dir: [number, number, number] = [0, 0, 0];
  private ownStepAcc = 0;
  private lastWeapon = -1;
  private wasReloading = false;
  private connected = false;
  private closedMsg = '';
  private useSlot: number | null = null;
  /** итог рейтингового матча — покажем в меню */
  private resultMsg = '';
  /** сервер закрыл комнату — не переподключаемся */
  private ended = false;

  constructor(
    private container: HTMLElement,
    private account: AccountInfo,
    private onExit: (msg?: string) => void,
    mapId = 'market',
    private mode: GameMode = 'public',
  ) {
    this.settings = { ...account.settings };
    this.info = (MAPS[mapId] ?? MAPS.market)();
    this.wrap = document.createElement('div');
    this.wrap.className = 'game';
    container.appendChild(this.wrap);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.wrap.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov * 0.75, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x9fd0f0);
    this.scene.fog = new THREE.Fog(0xcfe6f5, 45, 140);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xb08850, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
    sun.position.set(30, 60, 18);
    this.scene.add(sun);
    this.skyGroup = this.buildSkyDecor();
    this.scene.add(this.skyGroup);

    this.mapRenderer = new MapRenderer(this.info.map);
    this.scene.add(this.mapRenderer.group);
    this.debris = new Debris(this.info.map, 2000);
    this.scene.add(this.debris.mesh, this.tracers.lines, this.impacts.mesh, this.scorch.mesh);
    this.nadeView = new NadeView(() => this.info.map);
    this.scene.add(this.nadeView.group, this.smokeView.mesh, this.fireView.mesh, this.dropsView.group);

    this.bombMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.26), new THREE.MeshLambertMaterial({ color: 0x3b3f2a }));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    screen.position.y = 0.1;
    this.bombMesh.add(screen);
    this.bombLight = new THREE.PointLight(0xff2020, 0, 4);
    this.bombLight.position.y = 0.3;
    this.bombMesh.add(this.bombLight);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);

    this.vm = new ViewModel(account.loadout.skin);
    this.hud = new Hud(this.wrap, this.info);
    this.hud.preferred = { primary: account.loadout.primary[0], pistol: account.loadout.pistol[0] };
    this.hud.onChat = (t) => this.sendJson({ t: 'chat', text: t });
    this.hud.onBuy = (k) => this.sendJson({ t: 'buy', item: k });
    this.hud.onSell = (k) => this.sendJson({ t: 'sell', item: k });
    this.hud.onChatClose = () => this.lock();
    this.applySettings(this.settings);

    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause';
    this.wrap.appendChild(this.pauseEl);
    this.buildPause();

    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.connect();
    this.tickTimer = window.setInterval(this.tickLoop, 4);
    requestAnimationFrame(this.frame);
  }

  // ---------- Оформление ----------

  private nadeView: NadeView;
  private smokeView = new SmokeView();
  private fireView = new FireView();
  private dropsView = new DropsView();
  private nades: number[] = [0, 0, 0, 0];
  private hasKit = false;
  /** купленное в этом раунде, что можно продать (с сервера) */
  private sellList: string[] = [];
  private mapRenderer: MapRenderer;
  private skyGroup: THREE.Group;

  /** Смена карты после голосования: пересобираем меш, миникарту и окружение. */
  private setMap(id: string) {
    if (id === this.info.id || !MAPS[id]) return;
    this.info = MAPS[id]();
    this.scene.remove(this.mapRenderer.group, this.skyGroup);
    this.skyGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mapRenderer.dispose();
    this.mapRenderer = new MapRenderer(this.info.map);
    this.skyGroup = this.buildSkyDecor();
    this.scene.add(this.mapRenderer.group, this.skyGroup);
    this.debris.map = this.info.map;
    this.debris.clear();
    this.nadeView.clear();
    this.smokeView.clear();
    this.fireView.clear();
    this.dropsView.clear();
    this.impacts.clear();
    this.scorch.clear();
    this.hud.setMap(this.info);
    this.hud.info(`Карта: ${this.info.name}`);
  }

  private buildSkyDecor(): THREE.Group {
    const g = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa, emissiveIntensity: 0.4, fog: false });
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xd2ac74 });
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const cx = this.info.map.width / 2,
      cz = this.info.map.depth / 2;
    const reach = Math.max(cx, cz);
    for (let i = 0; i < 26; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(4 + r() * 6, 1.5 + r() * 1.5, 3 + r() * 5), cloudMat);
        b.position.set(k * 3 - n * 1.5, r() * 1.2, r() * 3);
        cl.add(b);
      }
      const a = r() * Math.PI * 2,
        d = 60 + r() * 90;
      cl.position.set(cx + Math.cos(a) * d, 28 + r() * 18, cz + Math.sin(a) * d);
      g.add(cl);
    }
    // башни и дома на горизонте
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + r() * 0.2;
      const d = reach + 16 + r() * 25;
      const h = 6 + r() * 14;
      const w = 3 + r() * 5;
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
      t.position.set(cx + Math.cos(a) * d, h / 2, cz + Math.sin(a) * d);
      g.add(t);
      if (r() < 0.5) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 2, w * 0.6), towerMat);
        top.position.set(t.position.x, h + 1, t.position.z);
        g.add(top);
      }
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0xc9ab7c }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0.45, cz);
    g.add(ground);
    return g;
  }

  applySettings(s: Settings) {
    this.settings = { ...s, binds: sanitizeBinds(s.binds) };
    this.binds = this.settings.binds;
    this.updatePauseHint();
    this.camera.fov = s.fov * 0.75;
    this.camera.updateProjectionMatrix();
    this.tracers.enabled = s.tracers;
    this.tracers.brightness = s.tracerBright;
    this.sfx.volume = s.volume;
  }

  /** Подсказка по управлению в паузе — по текущим привязкам. */
  private updatePauseHint() {
    const el = this.pauseEl?.querySelector(".pause-hint");
    if (!el) return;
    const k = (a: Action) => this.binds[a].map(keyLabel).join("/") || "—";
    el.textContent = `${k("forward")} ${k("left")} ${k("back")} ${k("right")} — ход · ${k("jump")} — прыжок · ${k("crouch")} — присесть · ${k("use")} — заложить/обезвредить/подобрать · ${k("reload")} — перезарядка · ${k("primary")}/${k("pistol")}/${k("knife")}, ${k("lastWeapon")} — оружие · ${k("grenade")} — гранаты · ${k("drop")} — выбросить · ${k("buy")} — покупка · ${k("team")} — команда · ${k("scoreboard")} — счёт · ${k("chat")} — чат · ПКМ — прицел снайперки. Клавиши меняются в главном меню: Настройки → Управление.`;
  }

  private buildPause() {
    this.pauseEl.innerHTML = `
      <div class="pause-box">
        <h2>ПАУЗА</h2>
        <button data-a="resume" class="btn primary">Продолжить</button>
        <button data-a="fullscreen" class="btn">На весь экран — Ctrl+W не закроет вкладку</button>
        <label>Чувствительность <input type="range" min="0.1" max="5" step="0.05" data-s="sens"></label>
        <label>Поле зрения <input type="range" min="60" max="110" step="1" data-s="fov"></label>
        <label><input type="checkbox" data-s="tracers"> Трассеры</label>
        <label>Яркость трассеров <input type="range" min="0" max="2" step="0.05" data-s="tracerBright"></label>
        <label>Громкость <input type="range" min="0" max="1" step="0.05" data-s="volume"></label>
        <label><input type="checkbox" data-s="confetti"> Режим «конфетти» вместо крови</label>
        <button data-a="exit" class="btn">Выйти в меню</button>
        <div class="pause-hint"></div>
      </div>`;
    const inputs = this.pauseEl.querySelectorAll<HTMLInputElement>('input[data-s]');
    const sync = () => {
      inputs.forEach((i) => {
        const k = i.dataset.s!;
        if (k === 'tracers') i.checked = this.settings.tracers;
        else if (k === 'confetti') i.checked = this.settings.blood === 'confetti';
        else i.value = String((this.settings as any)[k]);
      });
    };
    sync();
    this.updatePauseHint();
    inputs.forEach((i) =>
      i.addEventListener('input', () => {
        const k = i.dataset.s!;
        const s = { ...this.settings } as any;
        if (k === 'tracers') s.tracers = i.checked;
        else if (k === 'confetti') s.blood = i.checked ? 'confetti' : 'blood';
        else s[k] = Number(i.value);
        this.applySettings(s);
        this.onSettingsChanged?.(this.settings);
      }),
    );
    this.pauseEl.querySelector('[data-a=resume]')!.addEventListener('click', () => this.lock());
    this.pauseEl.querySelector('[data-a=fullscreen]')!.addEventListener('click', () => void this.enterFullscreen());
    this.pauseEl.querySelector('[data-a=exit]')!.addEventListener('click', () => this.exit());
  }

  onSettingsChanged: ((s: Settings) => void) | null = null;

  // ---------- Сеть ----------

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      ws.send(JSON.stringify({ t: 'auth', token: getToken(), mode: this.mode }));
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          this.onJson(JSON.parse(e.data));
        } catch (err) {
          console.error(err);
        }
      } else {
        const s = decodeSnapshot(e.data as ArrayBuffer);
        if (s) this.onSnapshot(s);
      }
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.running && !this.ended) {
        this.hud.showCenter('Соединение потеряно', this.closedMsg || 'Переподключение…', 3);
        if (!this.closedMsg) setTimeout(() => this.running && this.connect(), 2000);
      }
    };
  }

  private sendJson(m: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onJson(m: ServerMsg) {
    switch (m.t) {
      case 'st':
        this.st = m;
        if (this.pendingFull) {
          const f = this.pendingFull;
          this.pendingFull = null;
          this.onFull(f);
        }
        break;
      case 'me': {
        const wasSpec = this.spectator;
        this.myId = m.id;
        this.money = m.money;
        this.spectator = m.spectator;
        this.queue = m.queue;
        if (m.team !== this.myTeam && m.team >= 0) {
          const first = this.myTeam < 0;
          this.myTeam = m.team;
          this.vm.setTeam(m.team);
          // новая сторона приходит чуть позже начала раунда — разворачиваемся заново
          if (first || this.st?.ph === 'freeze') this.faceSpawnDirection();
          if (!first) this.hud.showCenter('Смена сторон', `Теперь ты играешь за: ${TEAM_LABEL[m.team]}`, 5, undefined, 'warn');
        }
        if (wasSpec !== m.spectator) this.pending.length = 0;
        // сервер сам меняет оружие при покупке и в начале раунда — следуем за ним
        if (m.pri !== this.priId) {
          if (m.pri >= 0 && this.priId < 0) this.slot = SLOT_PRIMARY;
          this.priId = m.pri;
        }
        this.pisId = m.pis;
        this.nades = m.nades;
        this.hasKit = m.kit;
        this.sellList = m.sell ?? [];
        if (this.slot >= 3 && this.nades[this.slot - 3] <= 0) this.slot = this.priId >= 0 ? SLOT_PRIMARY : SLOT_PISTOL;
        if (this.slot === SLOT_PRIMARY && this.priId < 0) this.slot = SLOT_PISTOL;
        break;
      }
      case 'full':
        this.onFull(m);
        break;
      case 'ev':
        for (const e of m.e) this.onEvent(e);
        break;
      case 'pong':
        this.ping = performance.now() - m.c;
        break;
      case 'kick':
        this.closedMsg = m.msg;
        this.hud.showCenter(m.msg, this.resultMsg, 10);
        // комната закрыта (матч окончен, отменён, нет мест) — обратно в меню
        if (m.end) this.ended = true;
        if (m.end) setTimeout(() => this.running && this.exit(), this.resultMsg ? 2500 : 4000);
        break;
      case 'rating': {
        const sign = m.delta > 0 ? '+' : '';
        this.resultMsg =
          m.mode === 'mm'
            ? `${m.won ? 'Победа' : 'Поражение'}: ${sign}${m.delta} Elo · ${m.elo} Elo · ${m.rank}`
            : `${m.won ? 'Победа' : 'Поражение'} · Союзники: ${m.rank}` + (m.promo ? ` · ${m.promo}` : '');
        this.hud.info(this.resultMsg);
        this.hud.showCenter(m.won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ', this.resultMsg, 15, performance.now() / 1000, m.won ? '' : 'warn');
        break;
      }
      case 'err':
        this.hud.info(m.msg);
        break;
    }
  }

  private serverTickNow(): number {
    return (performance.now() / 1000) * TICK_RATE + (this.clockOffset ?? 0);
  }

  private onSnapshot(s: Snapshot) {
    const nowT = (performance.now() / 1000) * TICK_RATE;
    const off = s.tick - nowT;
    if (this.clockOffset === null || Math.abs(off - this.clockOffset) > 32) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * (off > this.clockOffset ? 0.2 : 0.02);
    if (s.tick < this.latestTick) return;
    this.latestTick = s.tick;
    for (const e of s.ents) {
      const p = this.getPlayer(e.id);
      p.snaps.push({ tick: s.tick, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, flags: e.flags, weapon: e.weapon });
      if (p.snaps.length > 40) p.snaps.shift();
      p.lastTick = s.tick;
    }
    this.own = s.own;
    if (s.own.present) this.reconcile(s);
  }

  private reconcile(s: Snapshot) {
    const own = s.own;
    const alive = (own.flags & SF_ALIVE) !== 0;
    this.canMove = own.canMove;
    while (this.pending.length && this.pending[0].seq <= s.ackSeq) this.pending.shift();
    const st = this.tmpState;
    st.x = own.x;
    st.y = own.y;
    st.z = own.z;
    st.vx = own.vx;
    st.vy = own.vy;
    st.vz = own.vz;
    st.onGround = (own.flags & SF_ONGROUND) !== 0;
    st.crouch = (own.flags & SF_CROUCH) !== 0;
    if (!alive) {
      copyPState(this.pred, st);
      copyPState(this.prevPred, st);
      this.predAlive = false;
      this.errOffset.set(0, 0, 0);
      return;
    }
    const speedMul = WEAPONS[own.weapon]?.speed ?? 1;
    for (const c of this.pending) stepPlayer(st, c.buttons, c.yaw, this.info.map, this.canMove, speedMul);
    const ex = this.pred.x - st.x,
      ey = this.pred.y - st.y,
      ez = this.pred.z - st.z;
    const err = Math.hypot(ex, ey, ez);
    if (!this.predAlive || err > 1) {
      this.errOffset.set(0, 0, 0);
      copyPState(this.prevPred, st);
    } else if (err > 0.01) {
      this.errOffset.x += ex;
      this.errOffset.y += ey;
      this.errOffset.z += ez;
    }
    copyPState(this.pred, st);
    this.predAlive = true;
  }

  /** полное состояние, пришедшее раньше списка игроков (вход посреди раунда) */
  private pendingFull: FullState | null = null;

  private onFull(m: FullState) {
    // без списка игроков не знаем сторону и агента — тела строим, когда он придёт
    if (!this.st) {
      this.pendingFull = m;
      this.myId = m.you;
      this.setMap(m.map);
      return;
    }
    this.myId = m.you;
    this.setMap(m.map);
    // новое полное состояние (вход, новый раунд): пересобираем тела
    for (const p of this.players.values()) {
      p.body?.dispose();
      p.body = null;
      p.dead = false;
      p.snaps.length = 0;
    }
    this.debris.clear();
    this.impacts.clear();
    this.scorch.clear();
    this.nadeView.clear();
    this.smokeView.clear();
    this.fireView.clear();
    this.mapRenderer.clearChips();
    for (let i = 0; i + 9 < (m.chips ?? []).length; i += 10) this.mapRenderer.applyChip(chipFromArray(m.chips, i));
    const nowS = performance.now() / 1000;
    for (const s of m.smokes ?? []) this.smokeView.add(s.x, s.y, s.z, s.left, nowS);
    for (const fi of m.fires ?? []) this.fireView.add(fi.id, fi.x, fi.y, fi.z, FIRE_RADIUS, fi.left, FIRE_TIME, nowS);
    for (const c of m.corpses) {
      const p = this.getPlayer(c.i);
      p.dead = true;
      const body = this.ensureBody(p);
      if (!body) continue;
      computePose(c.x, c.y, c.z, c.yaw, 0, false, this.pose);
      body.applyPose(this.pose);
      body.ragdoll = new Ragdoll(this.info.map, this.pose, [0, 0, 0], 1, true);
      if (c.ex) body.explodeHead(this.debris, [0, 0.2, 0], this.settings.blood);
      p.renderPos = [c.x, c.y, c.z];
    }
    for (const w of m.wounds) {
      const p = this.getPlayer(w.i);
      const body = this.ensureBody(p);
      if (!body) continue;
      for (let i = 0; i + 5 < w.ops.length; i += 6) body.wound(w.ops[i], w.ops[i + 1], w.ops[i + 2], w.ops[i + 3], w.ops[i + 4], w.ops[i + 5] === 1, null, this.settings.blood);
    }
    this.pending.length = 0;
    this.predAlive = false;
  }

  private getPlayer(id: number): CPlayer {
    let p = this.players.get(id);
    if (!p) {
      p = { id, body: null, snaps: [], lastTick: 0, dead: false, stepAcc: 0, lastPos: [0, 0, 0], renderPos: [0, 0, 0], renderYaw: 0, renderPitch: 0, renderCrouch: false, renderSpeed: 0, anim: new AgentAnimator() };
      this.players.set(id, p);
    }
    return p;
  }

  private pub(id: number): PublicPlayer | undefined {
    return this.st?.pl[id];
  }

  private ensureBody(p: CPlayer): VoxelBody | null {
    const info = this.pub(p.id);
    if (!info) return null;
    if (p.body && (p.body.team !== info.t || p.body.agent !== info.ag)) {
      p.body.dispose();
      p.body = null;
    }
    if (!p.body) {
      p.body = new VoxelBody(info.t, info.ag, info.sk, this.bodyMat);
      this.scene.add(p.body.group);
    }
    return p.body;
  }

  private nameOf(id: number): string {
    return this.pub(id)?.n ?? '?';
  }

  private onEvent(e: GameEvent) {
    const now = performance.now() / 1000;
    const eye = this.cameraPos();
    switch (e.e) {
      case 'shot': {
        const isBot = this.pub(e.s)?.b ?? false;
        if (e.s === this.myId && this.predAlive) break; // свои выстрелы уже нарисованы
        // наблюдаем за стрелявшим от первого лица — его оружие дёргается, вспышка у дула
        if (!this.predAlive && e.s === this.specTarget) this.vm.fire();
        const shooter = this.players.get(e.s);
        shooter?.anim.fire(WEAPONS[this.pub(e.s)?.w ?? 1]?.kind ?? 'rifle');
        // начало трассера — примерно у дула оружия
        const yaw = shooter?.renderYaw ?? 0;
        const ax = e.a[0] + Math.cos(yaw) * 0.12,
          az = e.a[2] - Math.sin(yaw) * 0.12;
        this.tracers.add(ax, e.a[1] - 0.15, az, e.b[0], e.b[1], e.b[2], isBot);
        if (e.h === 1) this.markImpact(e.a, e.b);
        const d = Math.hypot(e.a[0] - eye.x, e.a[1] - eye.y, e.a[2] - eye.z);
        const w = WEAPONS[this.pub(e.s)?.w ?? 1];
        this.sfx.shot(w?.kind ?? 'rifle', d, this.panOf(e.a[0], e.a[2]), w?.key);
        break;
      }
      case 'wound': {
        const p = this.getPlayer(e.v);
        const body = this.ensureBody(p);
        body?.wound(e.p, e.x, e.y, e.z, e.r, e.x2 === 1, this.debris, this.settings.blood);
        break;
      }
      case 'kill': {
        const p = this.getPlayer(e.v);
        p.dead = true;
        // состояние комнаты придёт позже (4 раза в секунду) — отмечаем смерть сразу
        if (this.st?.pl[e.v]) this.st.pl[e.v].a = false;
        const body = this.ensureBody(p);
        if (body) {
          // поза в момент смерти
          if (e.v === this.myId) computePose(this.pred.x, this.pred.y, this.pred.z, this.yaw, this.pitch, this.pred.crouch, this.pose);
          else if (p.snaps.length && p.lastTick >= this.latestTick - 16) computePose(p.renderPos[0], p.renderPos[1], p.renderPos[2], p.renderYaw, p.renderPitch, p.renderCrouch, this.pose, p.anim.pose);
          else {
            // враг был скрыт от нас: тело появляется там, где он погиб
            p.renderPos = [e.at[0], e.at[1], e.at[2]];
            computePose(e.at[0], e.at[1], e.at[2], e.at[3], 0, false, this.pose);
          }
          body.applyPose(this.pose);
          // скорость, с которой бежал убитый (по двум последним снапшотам)
          let vel: [number, number, number] = [0, 0, 0];
          if (e.v === this.myId) vel = [this.pred.vx, this.pred.vy, this.pred.vz];
          else if (p.snaps.length >= 2) {
            const a = p.snaps[p.snaps.length - 2],
              b = p.snaps[p.snaps.length - 1];
            const t = Math.max(1, b.tick - a.tick) * DT;
            vel = [(b.x - a.x) / t, (b.y - a.y) / t, (b.z - a.z) / t];
            if (Math.hypot(vel[0], vel[2]) > 8) vel = [0, 0, 0];
          }
          // сила толчка зависит от оружия
          const kind = WEAPONS[e.w]?.kind;
          const k = kind === 'sniper' ? 2.6 : kind === 'shotgun' ? 2.2 : kind === 'grenade' ? 3 : kind === 'pistol' ? 1 : 1.4;
          const imp: [number, number, number] = [e.d[0] * k, e.d[1] * k + (kind === 'grenade' ? 2.5 : 0.4), e.d[2] * k];
          body.ragdoll = new Ragdoll(this.info.map, this.pose, imp, e.p, e.hs, vel);
          body.setWeapon('none');
          if (e.ex) body.explodeHead(this.debris, e.d, this.settings.blood);
        }
        const k = this.pub(e.k),
          v = this.pub(e.v);
        const wd = k ? WEAPONS[e.w] : null;
        this.hud.killFeed(k ? k.n : '', k ? k.t : 2, v ? v.n : '?', v ? v.t : 2, wd ? { key: wd.key, name: wd.name } : null, e.hs, e.ex, e.k === this.myId || e.v === this.myId);
        // «Headshot» — только тому, кто убил в голову; в рейтинговых режимах комментатора нет
        if (e.k === this.myId && e.hs && this.publicMode) this.sfx.announce('headshot');
        if (e.k === this.myId) {
          this.sfx.hit(e.hs);
          this.hud.hitMarker(now);
        }
        if (e.v === this.myId) {
          this.hud.showCenter('Вы убиты', `${k ? k.n : ''}${e.hs ? (e.ex ? ' · голова вдребезги' : ' · в голову') : ''}`, 3, now, 'dead');
          this.predAlive = false;
          this.specTarget = -1;
        }
        break;
      }
      case 'hurt':
        if (e.v === this.myId) {
          const ang = Math.atan2(e.from[0] - this.pred.x, e.from[2] - this.pred.z);
          // направление на стрелявшего относительно взгляда
          const rel = -(ang - Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw)));
          this.hud.damage(e.dmg, rel);
        } else if (this.players.has(e.v)) {
          // попадание по чужому — маркер, если стрелял я (по направлению)
          const dx = e.from[0] - this.pred.x,
            dz = e.from[2] - this.pred.z;
          if (Math.hypot(dx, dz) < 0.6) {
            this.hud.hitMarker(now);
            this.sfx.hit(false);
          }
        }
        break;
      case 'plant':
        this.hud.showCenter('Бомба заложена', `Точка ${this.info.siteNames[e.site] ?? ''}`, 3, now, 'warn');
        this.bombBeepAt = 0;
        break;
      case 'defuse':
        this.hud.showCenter('Бомба обезврежена', '', 3, now);
        break;
      case 'explode': {
        this.sfx.explosion();
        for (let i = 0; i < 160; i++) {
          const c = [0xffb03a, 0xff6a1a, 0x5a5048, 0x2e2a26][i % 4];
          this.debris.spawn(e.p[0], e.p[1] + 0.3, e.p[2], (Math.random() - 0.5) * 18, Math.random() * 14, (Math.random() - 0.5) * 18, c, 2 + Math.random() * 3, 3);
        }
        break;
      }
      case 'roundStart':
        this.faceSpawnDirection();
        this.slot = this.priId >= 0 ? SLOT_PRIMARY : SLOT_PISTOL;
        this.buyOpen = false;
        this.hud.showBuy(false, 0, false);
        {
          const hl = this.st?.hl ?? HALF_ROUNDS;
          const ot = overtimeOf(e.rn, hl);
          const title = ot ? `Овертайм${ot > 1 ? ' ' + ot : ''} · раунд ${e.rn}` : e.rn === hl * 2 ? `Раунд ${e.rn} — последний` : `Раунд ${e.rn}`;
          this.hud.showCenter(title, ot && swapsSidesBefore(e.rn, hl) ? `До ${winTarget(e.rn, hl)} побед · у всех $${OT_MONEY}` : 'Заморозка: покупка на B', 3, now, ot ? 'warn' : '');
        }
        this.specTarget = -1;
        break;
      case 'roundEnd':
        {
          const mvp = e.mvp !== undefined && e.mvp >= 0 ? this.pub(e.mvp) : undefined;
          this.hud.showCenter(`Победа: ${TEAM_LABEL[e.w]}`, e.why + (mvp ? ` · MVP: ${mvp.n}` : ""), 5, now, e.w === this.myTeam ? "win" : "lose");
          if (e.mvp === this.myId && this.myId >= 0) this.hud.info("Вы — MVP раунда!");
        }
        break;
      case 'matchEnd':
        this.hud.showCenter(`Матч окончен: победа — ${TEAM_LABEL[e.w]}`, 'Новый матч через 20 секунд', 19, now, 'win');
        this.boardOpen = true;
        setTimeout(() => (this.boardOpen = false), 19000);
        break;
      case 'half':
        this.hud.info('Смена сторон');
        break;
      case 'chat':
        this.hud.chat(e.n, e.t, e.text, e.dead);
        break;
      case 'info':
        this.hud.info(e.text);
        break;
      case 'nade': {
        const ahead = Math.max(0, Math.round(this.latestTick - e.tick));
        this.nadeView.spawn(e.id, e.type, e.p, e.v, ahead);
        if (e.s !== this.myId) this.sfx.click(260, 0.06, 0.12);
        break;
      }
      case 'boom': {
        this.nadeView.remove(e.id);
        const [x, y, z] = e.p;
        const d = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
        if (e.type === 0) {
          this.sfx.grenade(d);
          for (let i = 0; i < 70; i++) {
            const c = [0xffb03a, 0xff6a1a, 0x5a5048, 0x3a332c][i % 4];
            this.debris.spawn(x, y + 0.2, z, (Math.random() - 0.5) * 12, Math.random() * 9, (Math.random() - 0.5) * 12, c, 1 + Math.random() * 2, 1.8);
          }
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            this.markImpact([x, y + 0.2, z], [x + Math.cos(a) * 3, y - 0.6, z + Math.sin(a) * 3]);
          }
          // копоть: кольцо тёмных пятен вокруг воронки (не над ней) и на ближайших стенах
          for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2 + Math.random() * 0.25;
            const down = i % 2 === 0 ? 0.25 + Math.random() * 0.35 : Math.random() * 0.15;
            const dx = Math.cos(a),
              dz = Math.sin(a),
              dl = Math.hypot(1, down);
            if (raycastMap(this.info.map, x, y + 0.25, z, dx / dl, -down / dl, dz / dl, 3, this.mapHit)) {
              const h = this.mapHit;
              const t = h.t;
              const px = x + (dx / dl) * t,
                pz = z + (dz / dl) * t;
              if (h.ny > 0 && Math.hypot(px - x, pz - z) < 0.6) continue; // пол в воронке выбит
              this.scorch.add(px, y + 0.25 - (down / dl) * t, pz, h.nx, h.ny, h.nz, Math.max(2.5, 7 - t * 2));
            }
          }
        } else if (e.type === 1) {
          this.sfx.flashbang(d);
          for (let i = 0; i < 20; i++) this.debris.spawn(x, y + 0.2, z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0xffffff, 0.4, 1);
        } else if (e.type === 2) {
          this.sfx.smoke(d);
          this.smokeView.add(x, y, z, SMOKE_TIME, performance.now() / 1000);
        } else {
          // зажигательная разбилась: осколки стекла и брызги горючего (огонь придёт событием fire)
          this.sfx.glassBreak(d);
          for (let i = 0; i < 24; i++) this.debris.spawn(x, y + 0.1, z, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, i % 3 ? 0xff9a2a : 0x6b4a1e, 0.5, 1);
        }
        break;
      }
      case 'fire': {
        const [x, y, z] = e.p;
        this.fireView.add(e.id, x, y, z, e.r, e.dur, e.dur, performance.now() / 1000);
        this.sfx.fire(Math.hypot(x - eye.x, y - eye.y, z - eye.z), e.dur);
        break;
      }
      case 'announce': {
        if (!this.publicMode) break;
        const who = this.pub(e.s);
        const label = { firstblood: 'First Blood', doublekill: 'Double Kill', triplekill: 'Triple Kill', megakill: 'Mega Kill', rampage: 'Rampage' }[e.kind];
        this.sfx.announce(e.kind);
        if (who) this.hud.info(`${who.n}: ${label}!`);
        break;
      }
      case 'fireOut': {
        // дым потушил огонь: шипение и пар
        this.fireView.remove(e.id);
        this.sfx.smoke(10);
        break;
      }
      case 'flash': {
        const watching = this.predAlive ? this.myId : this.specTarget;
        if (e.v === watching) this.hud.flash(e.dur);
        break;
      }
      case 'chip': {
        const op = chipFromArray(e.c);
        if (this.mapRenderer.applyChip(op)) {
          // осколки — кубики размера под-вокселя цвета материала
          const mat = this.info.map.get(op.bx, op.by, op.bz);
          const col = MAT_COLORS[mat] ?? 0xb0a080;
          const px = (op.bx + (op.sx + 0.5) / 4) * 0.5,
            py = (op.by + (op.sy + 0.5) / 4) * 0.5,
            pz = (op.bz + (op.sz + 0.5) / 4) * 0.5;
          this.impacts.removeNear(px + op.nx * 0.06, py + op.ny * 0.06, pz + op.nz * 0.06, 0.2);
          const n = 2 + Math.floor(op.r2 / 2);
          for (let i = 0; i < n; i++)
            this.debris.spawn(px + op.nx * 0.08, py + op.ny * 0.08, pz + op.nz * 0.08, op.nx * 2 + (Math.random() - 0.5) * 2, op.ny * 2 + Math.random() * 2, op.nz * 2 + (Math.random() - 0.5) * 2, col, 6 + Math.random() * 4, (SUB_SIZE / 0.06) * 0.8);
        }
        break;
      }
      case 'pickup':
        if (e.s === this.myId) this.sfx.click(700, 0.05, 0.2);
        break;
      case 'reload':
        if (e.s === this.myId || (!this.predAlive && e.s === this.specTarget)) {
          const w = WEAPONS[e.s === this.myId ? (this.own?.weapon ?? 1) : (this.players.get(e.s)?.snaps.at(-1)?.weapon ?? 1)];
          this.vm.reload(w?.reload ?? 2);
          this.sfx.click(400, 0.06, 0.15);
        }
        break;
    }
  }

  /** Нападение смотрит на север (к точкам), защита — на юг. */
  private faceSpawnDirection() {
    if (this.myTeam < 0) return;
    this.yaw = this.myTeam === 0 ? Math.PI : 0;
    this.pitch = 0;
  }

  private markImpact(a: [number, number, number], b: [number, number, number]) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 0.01) return;
    if (raycastMap(this.info.map, a[0], a[1], a[2], dx / l, dy / l, dz / l, l + 0.3, this.mapHit)) {
      const h = this.mapHit;
      const px = a[0] + (dx / l) * h.t,
        py = a[1] + (dy / l) * h.t,
        pz = a[2] + (dz / l) * h.t;
      this.impacts.add(px, py, pz, h.nx, h.ny, h.nz);
      // пыль и сколы — кубики цвета материала
      const base = MAT_COLORS[h.mat] ?? 0xcbb38a;
      const col = Math.random() < 0.5 ? base : [0xcbb38a, 0x9a8a72, 0xe0cfa8][Math.floor(Math.random() * 3)];
      for (let i = 0; i < 4; i++) this.debris.spawn(px + h.nx * 0.05, py + h.ny * 0.05, pz + h.nz * 0.05, h.nx * 1.5 + (Math.random() - 0.5) * 1.5, h.ny * 1.5 + Math.random() * 1.5, h.nz * 1.5 + (Math.random() - 0.5) * 1.5, col, 1.5 + Math.random(), 0.8);
    }
  }

  private panOf(x: number, z: number): number {
    const dx = x - this.pred.x,
      dz = z - this.pred.z;
    const rx = Math.cos(this.yaw),
      rz = -Math.sin(this.yaw);
    const l = Math.hypot(dx, dz) || 1;
    return (dx * rx + dz * rz) / l;
  }

  // ---------- Ввод ----------

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (!this.locked()) this.lock();
    });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    this.wrap.addEventListener('mouseleave', () => (this.mouseX = -1));
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('contextmenu', this.onContext);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private unbindInput() {
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    (navigator as any).keyboard?.unlock?.();
    window.removeEventListener('resize', this.resize);
  }

  /**
   * Запасной режим без захвата мыши: некоторые браузеры и встроенные окна
   * (например, панель браузера в приложении) не разрешают pointer lock.
   * Тогда игра идёт и так: взгляд по движению мыши над окном, Esc — пауза.
   */
  private softLock = false;
  private lockWarned = false;

  private locked(): boolean {
    return this.softLock || document.pointerLockElement === this.renderer.domElement;
  }

  private realLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  private lock() {
    this.sfx.unlock();
    this.pauseEl.style.display = 'none';
    const el = this.renderer.domElement as any;
    const fallback = () => {
      if (!this.realLocked() && !this.hud.chatOpen && !this.buyOpen && !this.teamMenuOpen) this.enterSoftLock();
    };
    try {
      const r = el.requestPointerLock?.({ unadjustedMovement: true });
      if (r && r.catch)
        r.catch(() => {
          // без unadjustedMovement, а если и так нельзя — запасной режим
          const r2 = el.requestPointerLock?.();
          if (r2 && r2.catch) r2.catch(fallback);
        });
    } catch {
      try {
        el.requestPointerLock?.();
      } catch {
        fallback();
      }
    }
    // браузер может молча проигнорировать запрос
    setTimeout(fallback, 400);
  }

  private enterSoftLock() {
    this.softLock = true;
    this.pauseEl.style.display = 'none';
    this.wrap.classList.add('softlock');
    if (!this.lockWarned) {
      this.lockWarned = true;
      this.hud.info('Браузер не дал захватить мышь — включён запасной режим: поворот движением мыши над окном, Esc — пауза. Для полноценной игры откройте сайт в обычном Chrome, Edge или Firefox.');
    }
  }

  private pause() {
    this.softLock = false;
    this.wrap.classList.remove('softlock');
    if (this.realLocked()) document.exitPointerLock();
    this.keys.clear();
    this.mouseDown = false;
    this.rightDown = false;
    this.pauseEl.style.display = this.hud.chatOpen || this.buyOpen || this.teamMenuOpen ? 'none' : 'flex';
  }

  private onLockChange = () => {
    const l = this.realLocked();
    if (l) {
      this.softLock = false;
      this.wrap.classList.remove('softlock');
    }
    if (!l && !this.softLock) {
      this.pauseEl.style.display = this.hud.chatOpen || this.buyOpen || this.teamMenuOpen || this.st?.ph === 'vote' ? 'none' : 'flex';
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
    }
  };

  private onLockError = () => {
    if (!this.hud.chatOpen && !this.buyOpen) this.enterSoftLock();
  };

  /**
   * Полный экран + захват клавиатуры (Chrome, Edge): браузер отдаёт странице и Ctrl+W, и Ctrl+N,
   * поэтому присед на Ctrl с движением на W больше не закрывает вкладку. Выход — удерживать Esc.
   */
  private async enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await (navigator as any).keyboard?.lock?.();
    } catch {
      /* браузер не поддерживает — остаётся подтверждение при закрытии */
    }
    this.lock();
  }

  private onFullscreenChange = () => {
    if (!document.fullscreenElement) (navigator as any).keyboard?.unlock?.();
  };

  /** Пока идёт игра, закрытие вкладки (в том числе случайное Ctrl+W) спрашивает подтверждение. */
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!this.running) return;
    e.preventDefault();
    e.returnValue = '';
  };

  private onContext = (e: Event) => e.preventDefault();
  private onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    const r = this.wrap.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    if (!this.locked()) return;
    const scoped = this.isScoped();
    const k = 0.0022 * this.settings.sens * (scoped ? 0.35 : 1);
    this.yaw -= e.movementX * k;
    this.pitch -= e.movementY * k;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked()) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.fireTap = true;
      if (!this.predAlive) this.cycleSpectate();
    }
    if (e.button === 2) this.rightDown = !this.rightDown;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.hud.chatOpen) return;
    const code = e.code;
    // Tab браузер использует для перехода по полям — в игре он не нужен
    if (code === 'Tab') e.preventDefault();
    if (this.bound(code, 'scoreboard')) {
      e.preventDefault();
      this.boardOpen = true;
      return;
    }
    if (this.bound(code, 'chat')) {
      e.preventDefault();
      this.hud.openChat();
      if (this.realLocked()) document.exitPointerLock();
      return;
    }
    if (this.st?.ph === 'vote' && /^Digit[1-5]$/.test(code)) {
      const m = MAP_LIST[Number(code.slice(5)) - 1];
      if (m) this.castVote(m.id);
      return;
    }
    // в открытых меню цифры выбирают пункт, а не оружие
    if (this.teamMenuOpen && (code === 'Digit1' || code === 'Digit2')) {
      this.chooseTeam(code === 'Digit1' ? 0 : 1);
      return;
    }
    if (this.teamMenuOpen && code === 'Escape') {
      this.toggleTeamMenu();
      return;
    }
    if (this.bound(code, 'team')) {
      this.toggleTeamMenu();
      return;
    }
    if (this.bound(code, 'buy')) {
      this.toggleBuy();
      return;
    }
    if (this.buyOpen && /^Digit[0-9]$/.test(code)) {
      const key = this.hud.buyHotkey(Number(code.slice(5)));
      if (key) this.sendJson({ t: 'buy', item: key });
      return;
    }
    if (code === 'Escape' && this.buyOpen) {
      this.toggleBuy();
      return;
    }
    // Esc — пауза (в полном экране с захватом клавиатуры браузер сам мышь не отпускает)
    if (code === 'Escape' && (this.softLock || this.realLocked())) {
      this.pause();
      return;
    }
    if (!this.locked()) return;
    // во время игры сочетания с Ctrl не должны открывать окна браузера (сохранить, закладка, поиск…);
    // Ctrl+W/N/T браузер так не отдаёт — от них защищает полный экран и подтверждение закрытия
    if (e.ctrlKey || code === 'ControlLeft' || code === 'ControlRight') e.preventDefault();
    if (this.bound(code, 'primary')) this.selectSlot(SLOT_PRIMARY);
    if (this.bound(code, 'pistol')) this.selectSlot(SLOT_PISTOL);
    if (this.bound(code, 'knife')) this.selectSlot(SLOT_KNIFE);
    if (this.bound(code, 'lastWeapon')) this.selectSlot(this.lastSlot);
    // осмотр оружия — только своего, живым (прерывается выстрелом, перезарядкой, сменой оружия)
    if (this.bound(code, 'inspect') && this.predAlive && !e.repeat) this.vm.inspect();
    if (this.bound(code, 'grenade')) this.cycleGrenade();
    // пробел и прочие клавиши не должны прокручивать страницу
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    this.keys.add(code);
    this.tapped.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.bound(e.code, 'scoreboard')) this.boardOpen = false;
    this.keys.delete(e.code);
  };

  // ---------- Ники над головами ----------

  private nameTagLayer: HTMLDivElement | null = null;
  private nameTags = new Map<number, HTMLDivElement>();
  private tagPos = new THREE.Vector3();

  /**
   * Ник над головой у живых союзников (у наблюдателя — у всех, цветом стороны).
   * Союзники и так всегда приходят в снапшотах, поэтому ник виден и через стены, как на радаре.
   */
  private updateNameTags() {
    if (!this.nameTagLayer) {
      this.nameTagLayer = document.createElement('div');
      this.nameTagLayer.className = 'name-tags';
      this.wrap.appendChild(this.nameTagLayer);
    }
    const seen = new Set<number>();
    const cam = this.camera;
    const w = this.wrap.clientWidth,
      h = this.wrap.clientHeight;
    const spectating = this.spectator || this.myTeam < 0;
    for (const p of this.players.values()) {
      const info = this.pub(p.id);
      if (!info || p.dead || !info.a || p.id === this.myId) continue;
      if (!spectating && info.t !== this.myTeam) continue;
      // за кем наблюдаем от первого лица — тому ник не нужен
      if (!this.predAlive && p.id === this.specTarget) continue;
      if (!p.body?.group.visible) continue;
      const [x, y, z] = p.renderPos;
      this.tagPos.set(x, y + (p.renderCrouch ? 1.6 : 2.1), z);
      const dist = this.tagPos.distanceTo(cam.position);
      if (dist > 60) continue;
      this.tagPos.project(cam);
      if (this.tagPos.z > 1 || Math.abs(this.tagPos.x) > 1.1 || Math.abs(this.tagPos.y) > 1.1) continue;
      let el = this.nameTags.get(p.id);
      if (!el) {
        el = document.createElement('div');
        this.nameTagLayer.appendChild(el);
        this.nameTags.set(p.id, el);
      }
      const text = info.n + (info.hp >= 0 && info.hp < 100 ? ` · ${info.hp}` : '');
      if (el.textContent !== text) el.textContent = text;
      el.className = 'name-tag team' + info.t + (info.b ? ' bot' : '');
      el.style.transform = `translate(${((this.tagPos.x + 1) / 2) * w}px, ${((1 - this.tagPos.y) / 2) * h}px) translate(-50%, -100%)`;
      // дальше — мельче и прозрачнее
      el.style.opacity = String(Math.max(0.45, 1 - dist / 70));
      el.style.fontSize = `${Math.max(10, 14 - dist * 0.08)}px`;
      seen.add(p.id);
    }
    for (const [id, el] of this.nameTags)
      if (!seen.has(id)) {
        el.remove();
        this.nameTags.delete(id);
      }
  }

  // ---------- Смена команды (M) ----------

  private teamMenuOpen = false;
  private teamMenuEl: HTMLDivElement | null = null;

  private toggleTeamMenu() {
    this.teamMenuOpen = !this.teamMenuOpen;
    if (this.buyOpen && this.teamMenuOpen) this.toggleBuy();
    if (!this.teamMenuOpen) {
      this.teamMenuEl?.remove();
      this.teamMenuEl = null;
      this.lock();
      return;
    }
    this.softLock = false;
    if (this.realLocked()) document.exitPointerLock();
    this.pauseEl.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'pause team-menu';
    const box = document.createElement('div');
    box.className = 'pause-box';
    const h = document.createElement('h2');
    h.textContent = 'ВЫБОР КОМАНДЫ';
    box.append(h);
    for (const t of [0, 1]) {
      const pl = this.st?.pl.filter((p) => p.t === t) ?? [];
      const humans = pl.filter((p) => !p.b).length;
      const b = document.createElement('button');
      b.className = 'btn team-choice team' + t + (t === this.myTeam ? ' current' : '');
      b.textContent = `${t + 1} · ${TEAM_LABEL[t]} — людей ${humans}, ботов ${pl.length - humans}${t === this.myTeam ? ' (сейчас)' : ''}`;
      b.disabled = t === this.myTeam || pl.length - humans === 0;
      b.onclick = () => this.chooseTeam(t);
      box.append(b);
    }
    const hint = document.createElement('div');
    hint.className = 'pause-hint';
    hint.textContent = 'Место займёте у бота этой команды. Если вы живы и идёт раунд — переход в начале следующего. Убийства и деньги сохраняются. M или Esc — закрыть.';
    box.append(hint);
    el.append(box);
    this.wrap.append(el);
    this.teamMenuEl = el;
  }

  private chooseTeam(t: number) {
    this.sendJson({ t: 'team', team: t });
    if (this.teamMenuOpen) this.toggleTeamMenu();
  }

  private toggleBuy() {
    this.buyOpen = !this.buyOpen;
    this.hud.showBuy(this.buyOpen, this.money, this.canBuyLocal(), this.myTeam, this.sellList);
    if (this.buyOpen) {
      this.softLock = false;
      if (this.realLocked()) document.exitPointerLock();
    } else this.lock();
  }

  private canBuyLocal(): boolean {
    if (!this.st || !this.predAlive || this.myTeam < 0) return false;
    return (this.st.ph === 'freeze' || this.st.ph === 'live') && inRect(this.info.spawnZones[this.myTeam], this.pred.x, this.pred.z);
  }

  /** 4 — по кругу между гранатами, которые есть. */
  private cycleGrenade() {
    const have = [3, 4, 5, 6].filter((s) => this.nades[s - 3] > 0);
    if (!have.length) return;
    const i = have.indexOf(this.slot);
    this.selectSlot(have[(i + 1) % have.length]);
  }

  private selectSlot(s: number) {
    if (s === this.slot) return;
    if (s === SLOT_PRIMARY && !this.hasPrimary()) return;
    this.lastSlot = this.slot;
    this.slot = s;
    this.rightDown = false;
  }

  private hasPrimary(): boolean {
    return this.priId >= 0;
  }
  private priId = -1;
  private pisId = 1;

  private isScoped(): boolean {
    return this.rightDown && this.own !== null && WEAPONS[this.own.weapon]?.kind === 'sniper' && this.predAlive;
  }

  private cycleSpectate() {
    if (!this.st) return;
    const alive = this.st.pl.filter((p) => p.a && p.i !== this.myId && (this.spectator || this.myTeam < 0 || p.t === this.myTeam));
    if (!alive.length) return;
    const idx = alive.findIndex((p) => p.i === this.specTarget);
    this.specTarget = alive[(idx + 1) % alive.length].i;
  }

  private buttons(): number {
    if (this.hud.chatOpen || !this.locked()) return 0;
    let b = 0;
    // клавиши — по настройкам управления (Настройки → Управление)
    if (this.held('forward')) b |= BTN_FWD;
    if (this.held('back')) b |= BTN_BACK;
    if (this.held('left')) b |= BTN_LEFT;
    if (this.held('right')) b |= BTN_RIGHT;
    if (this.held('jump')) b |= BTN_JUMP;
    if (this.held('crouch')) b |= BTN_CROUCH;
    if (this.held('use')) b |= BTN_USE;
    if (this.held('reload')) b |= BTN_RELOAD;
    if (this.held('drop')) b |= BTN_DROP;
    if (this.mouseDown || this.fireTap) b |= BTN_FIRE;
    return b;
  }

  // ---------- Тик клиента ----------

  private clientTick() {
    const buttons = this.buttons();
    const viewTick = this.serverTickNow() - INTERP_DELAY * TICK_RATE;
    // закладка/обезвреживание: оружие не меняется (сервер всё равно не даст)
    if (this.usingNow) {
      this.useSlot ??= this.slot;
      this.slot = this.useSlot;
    } else this.useSlot = null;
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw: this.yaw, pitch: this.pitch, slot: this.slot, viewTick };
    if (this.predAlive) {
      copyPState(this.prevPred, this.pred);
      const speedMul = WEAPONS[this.own?.weapon ?? 1]?.speed ?? 1;
      stepPlayer(this.pred, buttons, this.yaw, this.info.map, this.canMove, speedMul);
      this.pending.push(cmd);
      if (this.pending.length > 128) this.pending.shift();
      this.simTime += DT;
      this.localRecoil *= Math.exp(-DT * 6);
      this.predictFire(cmd);
      // свои шаги
      const sp = Math.hypot(this.pred.vx, this.pred.vz);
      if (this.pred.onGround && sp > 3.5) {
        this.ownStepAcc += sp * DT;
        if (this.ownStepAcc > 2.2) {
          this.ownStepAcc = 0;
          this.sfx.step(0.5);
        }
      }
    }
    this.lastButtons = buttons;
    this.sentCmds.push(cmd);
    if (this.sentCmds.length > 3) this.sentCmds.shift();
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.spectator) this.ws.send(encodeCmds(this.sentCmds));
  }

  /** Мгновенный отклик на выстрел: вспышка, звук, трассер (сервер решает попадание). */
  private predictFire(cmd: UserCmd) {
    const own = this.own;
    if (!own || !(cmd.buttons & BTN_FIRE) || !this.canMove || cmd.buttons & BTN_USE) return;
    const def = WEAPONS[own.weapon];
    if (!def || own.flags & SF_RELOADING) return;
    if (this.simTime < this.localNextFire) return;
    if (def.kind === 'grenade') {
      if (this.lastButtons & BTN_FIRE || this.slot < 3) return;
      this.localNextFire = this.simTime + 0.8;
      this.vm.fire();
      this.sfx.click(300, 0.06, 0.15);
      const t = this.slot - 3;
      this.nades[t] = Math.max(0, this.nades[t] - 1);
      if (this.nades[t] === 0) this.slot = this.priId >= 0 ? SLOT_PRIMARY : SLOT_PISTOL;
      return;
    }
    if (!def.auto && this.lastButtons & BTN_FIRE) return;
    if (def.kind !== 'knife' && own.mag <= 0) return;
    if (this.slot !== def.slot) return;
    this.localNextFire = this.simTime + def.interval;
    const speed = Math.hypot(this.pred.vx, this.pred.vz);
    const spread = def.spread + (speed / RUN_SPEED) * def.moveSpread + (this.pred.onGround ? 0 : 0.08) + this.localRecoil * (this.pred.crouch ? 0.7 : 1);
    this.localRecoil = Math.min(this.localRecoil + def.recoil, def.recoilMax);
    this.vm.fire();
    this.sfx.shot(def.kind, 0, 0, def.key);
    if (def.kind === 'knife') return;
    const ex = this.pred.x,
      ey = this.pred.y + eyeHeight(this.pred),
      ez = this.pred.z;
    const seed = this.myId * 1000003 + cmd.seq;
    for (let k = 0; k < def.pellets; k++) {
      const d = shotDirection(cmd.yaw, cmd.pitch, spread, seed, k, this.dir);
      let t = def.range;
      let hitMap = false;
      if (raycastMap(this.info.map, ex, ey, ez, d[0], d[1], d[2], t, this.mapHit)) {
        t = this.mapHit.t;
        hitMap = true;
      }
      for (const p of this.players.values()) {
        if (p.id === this.myId || p.dead || !p.body || !p.body.group.visible) continue;
        const info = this.pub(p.id);
        if (!info || info.t === this.myTeam) continue;
        if (raycastBody(p.body.pose, ex, ey, ez, d[0], d[1], d[2], t, this.bodyHit)) {
          t = this.bodyHit.t;
          hitMap = false;
        }
      }
      const rx = Math.cos(this.yaw),
        rz = -Math.sin(this.yaw);
      this.tracers.add(ex + rx * 0.12 + d[0] * 0.5, ey - 0.12 + d[1] * 0.5, ez + rz * 0.12 + d[2] * 0.5, ex + d[0] * t, ey + d[1] * t, ez + d[2] * t, false);
      if (hitMap) this.markImpact([ex, ey, ez], [ex + d[0] * t, ey + d[1] * t, ez + d[2] * t]);
    }
  }

  // ---------- Тики 64 Гц, независимо от частоты кадров ----------

  private lastTickAt = performance.now();
  private tickTimer = 0;

  /**
   * Команды игроку шлются 64 раза в секунду, даже если браузер рисует мало кадров
   * (слабое железо, встроенное окно, свёрнутая панель). Иначе движение «замирает».
   */
  private tickLoop = () => {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    if (dt > 0.25) dt = 0.25;
    this.accum += dt;
    let n = 0;
    while (this.accum >= DT && n < 16) {
      this.edgeTurn();
      this.clientTick();
      this.tapped.clear();
      this.fireTap = false;
      this.accum -= DT;
      n++;
    }
    if (n === 16) this.accum = 0;
  };

  /** Запасной режим: курсор у края окна продолжает поворот, чтобы мышь «не упиралась». */
  private mouseX = -1;
  private mouseY = -1;
  private edgeTurn() {
    if (!this.softLock || this.mouseX < 0) return;
    const w = this.wrap.clientWidth,
      h = this.wrap.clientHeight;
    const edge = 0.08;
    const fx = this.mouseX / w,
      fy = this.mouseY / h;
    const speed = 2.6 * this.settings.sens * DT;
    if (fx < edge) this.yaw += speed * (1 - fx / edge);
    else if (fx > 1 - edge) this.yaw -= speed * (1 - (1 - fx) / edge);
    if (fy < edge) this.pitch = Math.min(1.55, this.pitch + speed * 0.6 * (1 - fy / edge));
    else if (fy > 1 - edge) this.pitch = Math.max(-1.55, this.pitch - speed * 0.6 * (1 - (1 - fy) / edge));
  }

  // ---------- Кадр ----------

  private frame = () => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const nowMs = performance.now();
    let dt = (nowMs - this.lastFrame) / 1000;
    this.lastFrame = nowMs;
    if (dt > 0.25) dt = 0.25;
    this.fpsAvg = this.fpsAvg * 0.95 + dt * 1000 * 0.05;
    this.adaptResolution(dt);

    // ввод и движение считает tickLoop по своему таймеру; здесь только доля тика для плавной камеры
    this.tickLoop();
    const alpha = Math.min(1, this.accum / DT);

    // сглаживание ошибки предсказания за ~100 мс
    this.errOffset.multiplyScalar(Math.exp(-dt * 25));
    if (this.errOffset.lengthSq() < 1e-6) this.errOffset.set(0, 0, 0);

    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      this.sendJson({ t: 'ping', c: performance.now() });
    }

    const now = nowMs / 1000;
    this.updatePlayers(dt);
    this.updateCamera(alpha);
    this.updateNameTags();
    this.debris.update(dt);
    this.mapRenderer.flush();
    this.nadeView.update(dt);
    this.smokeView.update(now);
    this.fireView.update(now);
    this.dropsView.sync(this.st?.drops ?? [], now);
    this.tracers.update(dt);
    this.updateBomb(now);
    this.updateHud(now);

    const w = this.wrap.clientWidth,
      h = this.wrap.clientHeight;
    const own = this.own;
    const speed = Math.hypot(this.pred.vx, this.pred.vz);
    // наблюдение от первого лица: руки, оружие и рукава того, за кем смотрим
    const spec = this.spectatedFirstPerson();
    if (spec) {
      const snap = spec.p.snaps[spec.p.snaps.length - 1];
      this.vm.setTeam(spec.team);
      this.vm.setWeapon(snap.weapon);
    } else {
      if (this.myTeam >= 0) this.vm.setTeam(this.myTeam);
      if (own) {
        this.vm.setWeapon(own.weapon);
        this.lastWeapon = own.weapon;
      }
    }
    const scoped = this.isScoped();
    this.camera.fov = scoped ? 20 : this.settings.fov * 0.75;
    this.camera.updateProjectionMatrix();
    // закладка/обезвреживание: свои (или того, за кем смотрим) руки у бомбы
    {
      const flags = spec ? spec.p.snaps[spec.p.snaps.length - 1]?.flags ?? 0 : this.own?.flags ?? 0;
      const team = spec ? spec.team : this.myTeam;
      const alive = spec ? true : this.predAlive;
      this.vm.setUse(alive && flags & SF_USING ? (team === 0 ? 'plant' : 'defuse') : null);
    }
    if (spec) this.vm.update(dt, spec.p.renderSpeed, w / h, true, false);
    else this.vm.update(dt, this.pred.onGround ? speed : 0, w / h, this.predAlive, scoped);
    this.wrap.classList.toggle('scoped', scoped);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.predAlive || spec) {
      this.renderer.clearDepth();
      this.renderer.render(this.vm.scene, this.vm.camera);
    }
  };

  /** За кем сейчас смотрим от первого лица (мёртвый или наблюдатель), если видим его. */
  private spectatedFirstPerson(): { p: CPlayer; team: number } | null {
    if (this.predAlive || this.specTarget < 0) return null;
    const p = this.players.get(this.specTarget);
    const info = this.pub(this.specTarget);
    if (!p || !info || p.dead || !info.a || !p.snaps.length || p.lastTick < this.latestTick - 64) return null;
    return { p, team: info.t };
  }

  private adaptResolution(dt: number) {
    this.resTimer += dt;
    if (this.resTimer < 2) return;
    this.resTimer = 0;
    let s = this.resScale;
    if (this.fpsAvg > 20 && s > 0.6) s -= 0.1;
    else if (this.fpsAvg < 13 && s < 1) s += 0.1;
    if (s !== this.resScale) {
      this.resScale = s;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * s);
      this.debris.quality = s;
      this.resize();
    }
  }

  private resize = () => {
    const w = this.wrap.clientWidth || window.innerWidth,
      h = this.wrap.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private updatePlayers(dt: number) {
    const renderTick = this.serverTickNow() - INTERP_DELAY * TICK_RATE;
    const eye = this.cameraPos();
    for (const p of this.players.values()) {
      const info = this.pub(p.id);
      const isMe = p.id === this.myId;
      if (p.dead) {
        const body = p.body;
        if (body?.ragdoll) {
          if (!body.ragdoll.sleeping) {
            body.ragdoll.update(dt);
            body.ragdoll.writeSegments(body.seg);
            body.applySegments(body.seg);
          }
          body.group.visible = true;
        }
        // труп лежит до конца раунда: «оживить» тело может только полное состояние нового раунда
        continue;
      }
      if (!info) continue;
      if (isMe) {
        if (p.body) p.body.group.visible = false;
        continue;
      }
      // интерполяция между двумя снапшотами
      const snaps = p.snaps;
      const visible = snaps.length > 0 && p.lastTick >= this.latestTick && (snaps[snaps.length - 1].flags & SF_ALIVE) !== 0;
      if (!visible) {
        if (p.body) p.body.group.visible = false;
        p.anim.reset(); // появится в другом месте — это не шаг
        continue;
      }
      let a = snaps[0],
        b = snaps[0];
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].tick <= renderTick) {
          a = snaps[i];
          b = snaps[Math.min(i + 1, snaps.length - 1)];
          break;
        }
      }
      if (renderTick < snaps[0].tick) a = b = snaps[0];
      // пропуск в данных (враг был невидим) — не тянем через стены
      if (b.tick - a.tick > 12) a = b;
      const t = b.tick > a.tick ? Math.min(1, Math.max(0, (renderTick - a.tick) / (b.tick - a.tick))) : 0;
      const x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t,
        z = a.z + (b.z - a.z) * t;
      const yaw = lerpAngle(a.yaw, b.yaw, t),
        pitch = a.pitch + (b.pitch - a.pitch) * t;
      const crouch = ((t < 0.5 ? a.flags : b.flags) & SF_CROUCH) !== 0;
      p.renderPos = [x, y, z];
      p.renderYaw = yaw;
      p.renderPitch = pitch;
      p.renderCrouch = crouch;
      const body = this.ensureBody(p);
      if (!body) continue;
      body.group.visible = p.id !== this.specTarget || this.predAlive;
      const kind = WEAPONS[b.weapon]?.kind ?? 'pistol';
      const using = (b.flags & SF_USING) !== 0 && (b.flags & SF_ONGROUND) !== 0;
      const an = p.anim.update(dt, { x, y, z, yaw, crouch, onGround: (b.flags & SF_ONGROUND) !== 0, reloading: (b.flags & SF_RELOADING) !== 0, weaponKind: kind, using });
      applyFore(an, WEAPONS[b.weapon]?.key);
      computePose(x, y, z, yaw, pitch, crouch, body.pose, an);
      body.applyPose(body.pose, an);
      // закладка — в руках бомба, обезвреживание — руки пустые (бомба уже на земле)
      const team = this.pub(p.id)?.t ?? 0;
      if (an.use > 0.5) body.setWeapon(team === 0 ? 'bomb' : 'none');
      else body.setWeapon(kind, WEAPONS[b.weapon]?.key);
      // шаги
      const sp = Math.hypot(x - p.lastPos[0], z - p.lastPos[2]) / Math.max(dt, 1e-3);
      p.renderSpeed = p.renderSpeed * 0.8 + Math.min(sp, 12) * 0.2;
      p.lastPos = [x, y, z];
      if (sp > 3.5 && sp < 12 && b.flags & SF_ONGROUND) {
        p.stepAcc += sp * dt;
        if (p.stepAcc > 2.2) {
          p.stepAcc = 0;
          this.sfx.step(Math.hypot(x - eye.x, z - eye.z), this.panOf(x, z));
        }
      }
    }
  }

  private cameraPos(): THREE.Vector3 {
    return this.camera.position;
  }

  private updateCamera(alpha: number) {
    const cam = this.camera;
    if (this.predAlive) {
      const a = this.prevPred,
        b = this.pred;
      const x = a.x + (b.x - a.x) * alpha + this.errOffset.x;
      const y = a.y + (b.y - a.y) * alpha + this.errOffset.y;
      const z = a.z + (b.z - a.z) * alpha + this.errOffset.z;
      const eh = eyeHeight(b);
      cam.position.set(x, y + eh, z);
      cam.rotation.set(this.pitch, this.yaw, 0);
      this.hud.setSpectate('');
      return;
    }
    // наблюдение: за живым товарищем (или любым игроком для наблюдателя)
    if (this.st) {
      const tgt = this.specTarget >= 0 ? this.st.pl[this.specTarget] : undefined;
      if (!tgt || !tgt.a) this.cycleSpectate();
    }
    const p = this.specTarget >= 0 ? this.players.get(this.specTarget) : undefined;
    if (p && !p.dead && p.snaps.length && p.lastTick >= this.latestTick - 64) {
      cam.position.set(p.renderPos[0], p.renderPos[1] + 1.62, p.renderPos[2]);
      cam.rotation.set(p.renderPitch, p.renderYaw, 0);
      const info = this.pub(p.id);
      const q = this.spectator ? (this.queue > 0 ? ` · вы в очереди: ${this.queue}` : ' · войдёте в игру в следующем раунде') : '';
      this.hud.setSpectate(`Наблюдение: ${info?.n ?? ''} (ЛКМ — следующий)${q}`);
    } else {
      // свободная камера над площадью
      const t = performance.now() / 1000;
      const cx = this.info.map.width / 2,
        cz = this.info.map.depth / 2;
      cam.position.set(cx + Math.cos(t * 0.1) * 20, 22, cz + Math.sin(t * 0.1) * 20);
      cam.lookAt(cx, 0, cz);
      this.hud.setSpectate(this.spectator ? (this.queue > 0 ? `Наблюдение · вы в очереди: ${this.queue}` : 'Наблюдение · вход в следующем раунде') : 'Ожидание следующего раунда');
    }
  }

  private updateBomb(now: number) {
    const st = this.st;
    const b = st?.bomb;
    if (!b || !b.p || (b.s !== 'dropped' && b.s !== 'planted')) {
      this.bombMesh.visible = false;
      this.bombLight.intensity = 0;
      return;
    }
    this.bombMesh.visible = true;
    this.bombMesh.position.set(b.p[0], b.p[1] + 0.09, b.p[2]);
    if (b.s === 'planted' && st) {
      const left = st.tl;
      const period = left > 20 ? 1 : left > 10 ? 0.5 : left > 4 ? 0.25 : 0.12;
      if (now >= this.bombBeepAt) {
        this.bombBeepAt = now + period;
        const d = this.cameraPos().distanceTo(this.bombMesh.position);
        if (d < 40) this.sfx.beep();
        this.bombLight.intensity = 3;
      } else this.bombLight.intensity = Math.max(0, this.bombLight.intensity - 0.3);
    }
  }

  private myVote = '';
  private lastPhase = '';

  private castVote(id: string) {
    this.myVote = id;
    this.sendJson({ t: 'vote', map: id });
  }

  private updateHud(now: number) {
    const own = this.own;
    const ph = this.st?.ph ?? '';
    if (ph !== this.lastPhase) {
      if (ph === 'vote') {
        // освобождаем мышь, чтобы можно было кликнуть по карте
        this.myVote = '';
        this.softLock = false;
        this.wrap.classList.remove('softlock');
        if (this.realLocked()) document.exitPointerLock();
        this.pauseEl.style.display = 'none';
      } else if (this.lastPhase === 'vote' && !this.locked()) {
        this.pauseEl.style.display = 'flex';
      }
      this.lastPhase = ph;
    }
    this.hud.showVote(this.st, this.myVote, (id) => this.castVote(id));
    const alive = this.predAlive;
    this.hud.update(this.st, { id: this.myId, team: this.myTeam, money: this.money }, now);
    if (own && own.present) {
      this.hud.setVitals(own.hp, own.armor, alive);
      const def = WEAPONS[own.weapon];
      this.hud.setWeapon(own.weapon, own.mag, own.reserve, slotList(this.priId >= 0 ? this.priId : null, this.pisId, def?.slot ?? this.slot, this.nades, this.hasKit, this.myTeam), (own.flags & SF_RELOADING) !== 0);
      // прогресс закладки/обезвреживания
      if (own.flags & SF_USING && alive) {
        const isT = this.myTeam === 0;
        const startedAt = (this as any)._useStart ?? now;
        (this as any)._useStart = startedAt;
        const total = isT ? PLANT_TIME : this.hasKit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
        this.hud.setProgress(isT ? 'Закладка бомбы…' : this.hasKit ? 'Обезвреживание с набором…' : 'Обезвреживание…', (now - startedAt) / total);
      } else {
        (this as any)._useStart = undefined;
        this.hud.setProgress('', null);
      }
      if (!own.present || !(own.flags & SF_RELOADING)) this.wasReloading = false;
    } else {
      this.hud.setVitals(0, 0, false);
      this.hud.setWeapon(0, 0, 0, [], false);
    }
    const def = own ? WEAPONS[own.weapon] : undefined;
    const sp = Math.hypot(this.pred.vx, this.pred.vz);
    const spread = def ? def.spread + (sp / RUN_SPEED) * def.moveSpread + (this.pred.onGround ? 0 : 0.08) + this.localRecoil : 0.01;
    this.hud.setCrosshair(spread, alive && !this.isScoped());
    this.hud.setNet(`${Math.round(1000 / this.fpsAvg)} FPS · пинг ${Math.round(this.ping)} мс${this.resScale < 1 ? ' · масштаб ' + Math.round(this.resScale * 100) + '%' : ''}${this.connected ? '' : ' · нет связи'}`);
    this.hud.showBoard(this.boardOpen, this.st, this.myId);
    if (this.buyOpen) {
      const key = `${this.money}|${this.canBuyLocal()}|${this.sellList.join(",")}`;
      if ((this as any)._buyKey !== key) {
        (this as any)._buyKey = key;
        this.hud.showBuy(true, this.money, this.canBuyLocal(), this.myTeam, this.sellList);
      }
    }
    // миникарта
    const dots: Array<{ x: number; z: number; c: string }> = [];
    if (this.st) {
      for (const p of this.players.values()) {
        const info = this.st.pl[p.id];
        if (!info || !info.a || p.id === this.myId || !p.snaps.length || p.lastTick < this.latestTick) continue;
        const friend = info.t === this.myTeam;
        dots.push({ x: p.renderPos[0], z: p.renderPos[2], c: friend ? (info.t === 0 ? '#f3c34a' : '#6fb2ff') : '#ff4040' });
      }
    }
    const b = this.st?.bomb;
    const cp = this.cameraPos();
    const myYaw = this.predAlive ? this.yaw : this.camera.rotation.y;
    this.hud.drawMinimap(cp.x, cp.z, myYaw, dots, b && b.p && (b.s === 'dropped' || b.s === 'planted' || b.s === 'carried') ? { x: b.p[0], z: b.p[2], planted: b.s === 'planted' } : null);
    void viewDirection;
  }

  /** Только для разработки: время перестройки чанка со сколами, мс */
  get chipRebuildMs(): number {
    return this.mapRenderer.lastRebuildMs;
  }

  /** Только для разработки: манекен перед камерой — раны, разлёт головы, рэгдолл. */
  debugDummy(opts: { team?: number; wounds?: number; explode?: boolean; kill?: boolean; dist?: number } = {}) {
    const team = opts.team ?? 1;
    const body = new VoxelBody(team, 0, 0, this.bodyMat);
    this.scene.add(body.group);
    body.setWeapon('rifle');
    const d = opts.dist ?? 2.2;
    const x = this.pred.x - Math.sin(this.yaw) * d,
      z = this.pred.z - Math.cos(this.yaw) * d;
    computePose(x, this.pred.y, z, this.yaw + Math.PI, 0, false, body.pose);
    body.applyPose(body.pose);
    body.group.updateMatrixWorld(true);
    const ex = this.pred.x,
      ey = this.pred.y + eyeHeight(this.pred),
      ez = this.pred.z;
    for (let i = 0; i < (opts.wounds ?? 6); i++) {
      const ty = this.pred.y + 0.6 + Math.random() * 0.9;
      const tx = x + (Math.random() - 0.5) * 0.4,
        tz = z;
      const dx = tx - ex,
        dy = ty - ey,
        dz = tz - ez;
      const l = Math.hypot(dx, dy, dz);
      if (raycastBody(body.pose, ex, ey, ez, dx / l, dy / l, dz / l, 10, this.bodyHit)) {
        const h = this.bodyHit;
        body.wound(h.part, h.ix, h.iy, h.iz, 1, false, this.debris, this.settings.blood);
        if (h.part === 1) body.wound(h.part, h.ex, h.ey, h.ez, 2, true, this.debris, this.settings.blood);
      }
    }
    const dir: [number, number, number] = [-Math.sin(this.yaw), 0.1, -Math.cos(this.yaw)];
    if (opts.explode) body.explodeHead(this.debris, dir, this.settings.blood);
    if (opts.kill) {
      body.ragdoll = new Ragdoll(this.info.map, body.pose, [dir[0] * 3.5, 0.8, dir[2] * 3.5], opts.explode ? 0 : 1, !!opts.explode);
      const fake: CPlayer = { id: 100 + Math.floor(Math.random() * 1000), body, snaps: [], lastTick: 0, dead: true, stepAcc: 0, lastPos: [0, 0, 0], renderPos: [x, this.pred.y, z], renderYaw: 0, renderPitch: 0, renderCrouch: false, renderSpeed: 0, anim: new AgentAnimator() };
      this.players.set(fake.id, fake);
      if (this.st && !this.st.pl[fake.id]) (this.st.pl as any)[fake.id] = { i: fake.id, n: 'манекен', t: team, b: true, a: false, k: 0, d: 0, hp: 0, m: -1, w: 5, ag: 0, sk: 0, c: true, bomb: false };
    }
    return body;
  }

  /** свой игрок сейчас закладывает или обезвреживает бомбу */
  private get usingNow(): boolean {
    return this.predAlive && !!this.own && (this.own.flags & SF_USING) !== 0 && this.held('use');
  }

  /** паблик (с комментатором) или рейтинговый режим */
  private get publicMode(): boolean {
    return (this.st?.mode ?? this.mode) === 'public';
  }

  private exit() {
    this.dispose();
    this.onExit(this.resultMsg || (this.closedMsg && this.mode !== 'public' ? this.closedMsg : undefined));
  }

  dispose() {
    this.running = false;
    clearInterval(this.tickTimer);
    this.unbindInput();
    if (this.realLocked()) document.exitPointerLock();
    this.ws?.close();
    for (const p of this.players.values()) p.body?.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.wrap.remove();
  }
}
