// Ключевые кадры оружия от первого лица: доставание, перезарядка, удары ножом, осмотр.
// Каждый кадр — доля времени t (0..1) и любые из каналов; канал, которого нет в кадре,
// плавно тянется от предыдущего кадра, где он задан, к следующему.
// Моменты щелчков перезарядки берутся из общей таблицы RELOAD_TIMINGS (shared/reloadSounds.ts),
// поэтому магазин встаёт на место ровно под звук «mag_in», затвор — под «bolt» и т. д.

import { RELOAD_TIMINGS, reloadSteps, type ReloadSoundName } from '../../../shared/src/index';

export type V3 = readonly [number, number, number];

export interface VmKey {
  t: number;
  /** смещение и поворот рук с оружием (система рук, поворот вокруг правой кисти) */
  p?: V3;
  r?: V3;
  /** левая кисть: доля пути к магазину / к затвору / к окну заряжания (барабану), 0 — на своём месте */
  hm?: number;
  hb?: number;
  hp?: number;
  /** добавочное смещение левой кисти (система рук) */
  l?: V3;
  /** магазин (или барабан): смещение от гнезда в системе оружия и поворот */
  m?: V3;
  mr?: V3;
  /** правая кисть: смещение (затвор у снайперки) */
  rh?: V3;
  /** в левой руке патрон / скорозарядник: 1 — виден */
  s?: number;
  /** нож: вращение клинка вокруг оси рукояти (рука держит рукоять) */
  kz?: number;
  /** нож: переворот через острие (вокруг поперечной оси; у керамбита — вокруг кольца на пальце) */
  kx?: number;
  /** кривая участка, который заканчивается этим кадром (по умолчанию — у дорожки) */
  e?: Ease;
}

/**
 * Кривые: io — разгон и торможение; out — резкий старт и мягкий доводящий конец (основная,
 * как в шутерах последних лет); in — разгон к удару; snap — очень резкий старт; lin — равномерно.
 */
export type Ease = 'io' | 'out' | 'in' | 'snap' | 'lin';
const EASE: Record<Ease, (t: number) => number> = {
  io: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  snap: (t) => 1 - (1 - t) ** 5,
  lin: (t) => t,
};

type Chan = Exclude<keyof VmKey, 't'>;
const VEC: Chan[] = ['p', 'r', 'l', 'm', 'mr', 'rh'];
const NUM: Chan[] = ['hm', 'hb', 'hp', 's', 'kz', 'kx'];

export interface VmPose {
  p: [number, number, number];
  r: [number, number, number];
  l: [number, number, number];
  m: [number, number, number];
  mr: [number, number, number];
  rh: [number, number, number];
  hm: number;
  hb: number;
  hp: number;
  s: number;
  kz: number;
  kx: number;
}

export function newVmPose(): VmPose {
  return { p: [0, 0, 0], r: [0, 0, 0], l: [0, 0, 0], m: [0, 0, 0], mr: [0, 0, 0], rh: [0, 0, 0], hm: 0, hb: 0, hp: 0, s: 0, kz: 0, kx: 0 };
}

export function clearVmPose(o: VmPose) {
  for (const c of VEC) (o[c as 'p'] as number[]).fill(0);
  for (const c of NUM) (o as unknown as Record<string, number>)[c] = 0;
}

/** Анимация: кадры по каждому каналу отдельно (кадры, где канал не задан, пропускаются). */
export class VmTrack {
  private chans = new Map<Chan, { t: number[]; v: number[][]; e: Array<(t: number) => number> }>();

  constructor(
    readonly keys: readonly VmKey[],
    ease: Ease = 'out',
  ) {
    const sorted = [...keys].sort((a, b) => a.t - b.t);
    for (const c of [...VEC, ...NUM]) {
      const t: number[] = [],
        v: number[][] = [],
        e: Array<(t: number) => number> = [];
      for (const k of sorted) {
        const x = k[c];
        if (x === undefined) continue;
        t.push(k.t);
        v.push(typeof x === 'number' ? [x] : [...(x as V3)]);
        e.push(EASE[k.e ?? ease]);
      }
      if (t.length) this.chans.set(c, { t, v, e });
    }
  }

  /** Добавить позу в момент k (0..1) к out (каналы складываются — так поверх доставания идёт перезарядка). */
  sample(k: number, out: VmPose, w = 1) {
    for (const [c, ch] of this.chans) {
      const n = ch.t.length;
      let a: number[], b: number[], s: number;
      if (k <= ch.t[0]) (a = b = ch.v[0]), (s = 0);
      else if (k >= ch.t[n - 1]) (a = b = ch.v[n - 1]), (s = 0);
      else {
        let i = 0;
        while (i < n - 2 && k > ch.t[i + 1]) i++;
        a = ch.v[i];
        b = ch.v[i + 1];
        s = ch.e[i + 1]((k - ch.t[i]) / Math.max(1e-6, ch.t[i + 1] - ch.t[i]));
      }
      if (a.length === 1) (out as unknown as Record<string, number>)[c] += (a[0] + (b[0] - a[0]) * s) * w;
      else {
        const o = out[c as 'p'];
        for (let j = 0; j < 3; j++) o[j] += (a[j] + (b[j] - a[j]) * s) * w;
      }
    }
  }
}

const Z: V3 = [0, 0, 0];
const TAU = Math.PI * 2;

// ---------------- Перезарядка ----------------

function at(kind: string, key: string, name: ReloadSoundName, nth = 0): number {
  const s = reloadSteps(kind, key).filter(([, n]) => n === name);
  return s[Math.min(nth, s.length - 1)]?.[0] ?? 0.5;
}

/** Наклон оружия на время перезарядки: магазином к центру экрана, дулом чуть вверх и влево */
const TILT_LONG: V3 = [0.22, 0.3, -0.55];
const TILT_PISTOL: V3 = [0.2, 0.5, -0.45];
/** и подъём, чтобы гнездо магазина вышло из-за нижнего края экрана */
const LIFT_LONG: V3 = [-0.06, 0.14, 0.02];
const LIFT_PISTOL: V3 = [-0.13, 0.13, -0.02];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Магазинное оружие: наклон → левая рука к магазину → магазин вниз (mag_out) → новый снизу
 * → встаёт в гнездо (mag_in) → рука к затвору → рывок (bolt) → обратно.
 */
function magReload(kind: string, key: string, pistol: boolean): VmKey[] {
  const tOut = at(kind, key, 'mag_out');
  const tIn = at(kind, key, 'mag_in');
  const tBolt = at(kind, key, 'bolt', 9);
  const tilt = pistol ? TILT_PISTOL : TILT_LONG;
  const lift = pistol ? LIFT_PISTOL : LIFT_LONG;
  const mid = (tOut + tIn) / 2;
  return [
    { t: 0, p: Z, r: Z, hm: 0, hb: 0, m: Z, mr: Z, l: Z },
    { t: Math.max(0.03, tOut - 0.09), p: lift, r: tilt, hm: 1 },
    // щелчок защёлки — магазин чуть сдвинулся, дальше рука тянет его вниз и уносит за край экрана
    { t: tOut, m: [0, -0.012, 0], mr: Z, p: add(lift, [0, 0.008, 0]) },
    { t: tOut + 0.05, p: lift },
    { t: tOut + 0.16, m: [0, -0.2, 0.05], mr: [0.3, 0, 0.2] },
    { t: mid, m: [0, -0.4, 0.08], mr: [0.3, 0, 0.25], hm: 1 },
    // новый магазин поднимается снизу и заходит в гнездо
    { t: tIn - 0.12, m: [0, -0.07, 0.015], mr: [0.12, 0, 0.05] },
    { t: tIn - 0.03, m: [0, -0.012, 0], mr: Z, p: lift },
    { t: tIn, m: Z, p: add(lift, [0, 0.018, 0]), hm: 1, hb: 0, r: tilt },
    { t: tIn + 0.05, p: lift },
    // рука к затвору, рывок назад под щелчок
    { t: tBolt - 0.07, hm: 0, hb: 1, l: Z, r: mul(tilt, 0.5), p: mul(lift, 0.6) },
    // затвор: короткий ход назад вдоль ствола (+Z) и сразу вперёд
    { t: tBolt, l: [0, 0, 0.045], p: add(mul(lift, 0.6), [0, 0.008, 0.012]) },
    { t: tBolt + 0.06, l: Z, p: mul(lift, 0.5) },
    { t: Math.min(0.99, tBolt + 0.12), hb: 0.4 },
    { t: 1, p: Z, r: Z, hb: 0, hm: 0, l: Z },
  ];
}

/** Дробовик: по патрону в окно снизу, потом передёрнуть цевьё (pump). */
function shotgunReload(kind: string, key: string): VmKey[] {
  const shells = reloadSteps(kind, key).filter(([, n]) => n === 'shell').map(([t]) => t);
  const tPump = at(kind, key, 'pump');
  const tilt: V3 = [0.15, 0.25, -0.6];
  const lift: V3 = [-0.06, 0.12, 0.02];
  const ks: VmKey[] = [
    { t: 0, p: Z, r: Z, hp: 0, s: 0, l: Z },
    { t: Math.max(0.02, shells[0] - 0.07), p: lift, r: tilt, hp: 0.5, s: 1, l: [-0.02, -0.08, 0.03] },
  ];
  const gap = shells.length > 1 ? shells[1] - shells[0] : 0.1;
  for (let i = 0; i < shells.length; i++) {
    const t = shells[i];
    // рука снизу с патроном → вдавить в окно (щелчок) → снова вниз за следующим
    ks.push({ t: t - gap * 0.45, hp: 0.75, l: [-0.02, -0.07, 0.03] });
    ks.push({ t, hp: 1, l: [0, 0.005, -0.01], p: add(lift, [0, 0.006, 0]) });
    if (i < shells.length - 1) ks.push({ t: t + gap * 0.3, hp: 0.8, l: [-0.02, -0.05, 0.03], p: lift });
  }
  const last = shells[shells.length - 1];
  ks.push({ t: last + 0.05, s: 0 });
  // цевьё: рука обратно на цевьё, рывок назад-вперёд
  ks.push({ t: tPump - 0.08, hp: 0, l: Z, r: [0.06, 0.05, 0.12], p: [0, 0.01, 0] });
  ks.push({ t: tPump - 0.02, l: [0, -0.005, 0.1], p: [0, 0.015, 0.02] });
  ks.push({ t: tPump + 0.05, l: Z, p: [0, 0.005, -0.005] });
  ks.push({ t: 1, p: Z, r: Z, l: Z, hp: 0, s: 0 });
  return ks;
}

/** Револьвер: барабан откидывается влево (cyl_open), скорозарядник (cyl_load), барабан на место (cyl_close). */
function revolverReload(kind: string, key: string): VmKey[] {
  const tOpen = at(kind, key, 'cyl_open');
  const tLoad = at(kind, key, 'cyl_load');
  const tClose = at(kind, key, 'cyl_close');
  const tilt: V3 = [0.3, 0.35, 0.75];
  const outM: V3 = [-0.035, -0.012, 0];
  const outR: V3 = [0, 0, 0.9];
  return [
    { t: 0, p: Z, r: Z, m: Z, mr: Z, hp: 0, s: 0, l: Z },
    { t: Math.max(0.02, tOpen - 0.06), p: [-0.1, 0.11, 0], r: [tilt[0] * 0.6, tilt[1] * 0.6, tilt[2] * 0.6], hp: 0.6, l: [0, -0.02, 0] },
    { t: tOpen, m: Z, mr: Z, hp: 1, l: Z },
    { t: tOpen + 0.08, m: outM, mr: outR, r: tilt },
    // гильзы вытряхнуть: ствол вверх
    { t: tOpen + 0.16, r: [0.7, 0.3, 0.6], p: [-0.1, 0.13, 0.02], hp: 0.3, l: [0, -0.1, 0.05] },
    { t: tLoad - 0.12, r: tilt, p: [-0.1, 0.11, 0], hp: 0.6, s: 1, l: [-0.01, -0.12, 0.06] },
    { t: tLoad, hp: 1, l: [0, 0.008, 0.012], s: 1 },
    { t: tLoad + 0.06, l: [0, -0.02, 0.03] },
    { t: tLoad + 0.12, s: 0, hp: 0.7 },
    { t: tClose - 0.06, m: outM, mr: outR, hp: 1, l: Z },
    { t: tClose, m: Z, mr: Z, p: [-0.06, 0.08, 0] },
    { t: Math.min(0.99, tClose + 0.05), hp: 0.5, p: [0, 0.01, 0] },
    { t: 1, p: Z, r: Z, hp: 0, l: Z, m: Z, mr: Z, s: 0 },
  ];
}

/**
 * Снайперка (болт): правая рука — к рукоятке затвора, вверх-назад (bolt), левая меняет магазин,
 * затвор вперёд-вниз (bolt).
 */
function sniperReload(kind: string, key: string): VmKey[] {
  const b1 = at(kind, key, 'bolt', 0);
  const b2 = at(kind, key, 'bolt', 9);
  const tOut = at(kind, key, 'mag_out');
  const tIn = at(kind, key, 'mag_in');
  const tilt: V3 = [0.2, 0.28, -0.5];
  const lift: V3 = [-0.06, 0.13, 0.02];
  const up: V3 = [0.015, 0.05, 0.0];
  const back: V3 = [0.015, 0.055, 0.08];
  return [
    { t: 0, p: Z, r: Z, rh: Z, hm: 0, m: Z, mr: Z },
    { t: Math.max(0.02, b1 - 0.07), rh: [0.01, 0.045, -0.02], r: [0.05, 0.05, 0.2] },
    { t: b1 - 0.02, rh: up },
    { t: b1, rh: back, p: [0, 0.01, 0.015] },
    { t: b1 + 0.06, p: Z, r: [0.05, 0.05, 0.2] },
    { t: tOut - 0.08, r: tilt, hm: 1, p: lift },
    { t: tOut, m: [0, -0.012, 0] },
    { t: tOut + 0.12, m: [0, -0.3, 0.05], mr: [0.3, 0, 0.2] },
    { t: (tOut + tIn) / 2, m: [0, -0.4, 0.05], hm: 1 },
    { t: tIn - 0.08, m: [0, -0.05, 0.01], mr: [0.1, 0, 0.05] },
    { t: tIn, m: Z, mr: Z, p: add(lift, [0, 0.015, 0]), hm: 1, rh: back, r: tilt },
    { t: tIn + 0.08, hm: 0, p: [0, 0.01, 0], r: [0.05, 0.05, 0.2] },
    { t: b2 - 0.06, rh: back },
    { t: b2 - 0.02, rh: up },
    { t: b2, rh: [0.01, 0.045, -0.02], p: [0, 0.012, -0.01] },
    { t: Math.min(0.99, b2 + 0.06), rh: Z, p: Z },
    { t: 1, p: Z, r: Z, rh: Z, hm: 0 },
  ];
}

const reloadCache = new Map<string, VmTrack>();

/** Перезарядка для оружия: набор кадров по виду (револьверы — по ключу). */
export function reloadTrack(kind: string, key: string): VmTrack {
  const steps = reloadSteps(kind, key);
  const ck = steps === RELOAD_TIMINGS.revolver ? 'revolver' : kind;
  let t = reloadCache.get(ck);
  if (!t) {
    const keys =
      ck === 'revolver' ? revolverReload(kind, key) : kind === 'shotgun' ? shotgunReload(kind, key) : kind === 'sniper' ? sniperReload(kind, key) : magReload(kind, key, kind === 'pistol');
    t = new VmTrack(keys);
    reloadCache.set(ck, t);
  }
  return t;
}

// ---------------- Доставание ----------------
// Темп: резкий рывок снизу (кривая snap), небольшой перелёт и мягкая доводка в покой.

const DRAW_GUN = new VmTrack([
  { t: 0, p: [0.03, -0.3, 0.08], r: [-1.0, 0.3, 0.75] },
  { t: 0.62, p: [0, 0.008, -0.006], r: [0.05, -0.02, -0.04], e: 'snap' },
  { t: 1, p: Z, r: Z, e: 'io' },
]);
const DRAW_NADE = new VmTrack([
  { t: 0, p: [0, -0.3, 0.06], r: [-0.6, 0.2, 0.3] },
  { t: 0.65, p: [0, 0.01, 0], r: [0.04, 0, 0], e: 'snap' },
  { t: 1, p: Z, r: Z, e: 'io' },
]);

export type KnifeAnimKind = 'bayonet' | 'karambit';

/** Штык-нож: поднимается снизу и на ходу переворачивается в пальцах через острие. */
const DRAW_BAYONET = new VmTrack([
  { t: 0, p: [0.05, -0.24, 0.05], r: [-0.5, 0.1, -0.35], kx: -TAU, kz: 0 },
  { t: 0.6, p: [0, 0.01, 0], r: [0.06, 0, 0.04], e: 'snap' },
  { t: 0.82, kx: 0.12, e: 'out' },
  { t: 1, p: Z, r: Z, kx: 0, e: 'io' },
]);
/** Керамбит: крутится на пальце в кольце (два оборота), ловится в хват. */
const DRAW_KARAMBIT = new VmTrack([
  { t: 0, p: [0.04, -0.22, 0.05], r: [-0.4, 0.15, -0.3], kx: -2 * TAU },
  { t: 0.6, p: [0, 0.012, 0], r: [0.05, 0, 0], e: 'snap' },
  { t: 0.85, kx: 0.18, e: 'out' },
  { t: 1, p: Z, r: Z, kx: 0, e: 'io' },
]);

export function drawTrack(kind: string, knife: KnifeAnimKind = 'bayonet'): VmTrack {
  if (kind === 'knife') return knife === 'karambit' ? DRAW_KARAMBIT : DRAW_BAYONET;
  return kind === 'grenade' ? DRAW_NADE : DRAW_GUN;
}

// ---------------- Нож: удары, осмотр, поза в покое ----------------

/** Поза ножа в покое: ниже и правее, острие вперёд-вверх. */
export const KNIFE_REST_P: V3 = [0.035, -0.04, 0.0];
export const KNIFE_REST_R: V3 = [-0.38, 0.0, -0.05];

/** Длительность удара, с (интервал ножа на сервере — 0.55: удар и короткая пауза). */
export const SWING_DUR = 0.45;

/**
 * Удары — короткий замах (резкий старт), разгон в рез через центр экрана (кривая in),
 * проводка за край и плавный возврат в покой.
 */
/** Удар справа налево: замах вправо-вверх, рез наискось влево-вниз. */
export const SWING_RL = new VmTrack([
  { t: 0, p: Z, r: Z },
  { t: 0.16, p: [0.06, 0.05, 0.03], r: [0.25, -0.6, -0.9], e: 'out' },
  { t: 0.36, p: [-0.15, -0.02, -0.11], r: [-0.25, 0.65, 0.55], e: 'in' },
  { t: 0.5, p: [-0.21, -0.08, -0.05], r: [-0.45, 0.85, 0.75], e: 'out' },
  { t: 1, p: Z, r: Z, e: 'io' },
]);
/** Удар слева направо: замах влево-вверх, рез наотмашь вправо-вниз. */
export const SWING_LR = new VmTrack([
  { t: 0, p: Z, r: Z },
  { t: 0.16, p: [-0.08, 0.06, 0.03], r: [0.25, 0.75, 1.0], e: 'out' },
  { t: 0.36, p: [0.07, -0.04, -0.11], r: [-0.3, -0.6, -0.5], e: 'in' },
  { t: 0.5, p: [0.1, -0.1, -0.04], r: [-0.5, -0.8, -0.6], e: 'out' },
  { t: 1, p: Z, r: Z, e: 'io' },
]);

/** Осмотр оружия: из таблицы [k, px, py, pz, rx, ry, rz] в кадры (плавно, без рывков). */
function inspectTrack(rows: Array<[number, number, number, number, number, number, number]>): VmTrack {
  return new VmTrack(
    rows.map(([t, px, py, pz, rx, ry, rz]) => ({ t, p: [px, py, pz], r: [rx, ry, rz] })),
    'io',
  );
}

/**
 * Осмотр штык-ножа: кисть поворачивает клинок плашмя к себе, нож переворачивается в пальцах
 * вокруг рукояти (видна другая сторона), кисть показывает острие, ещё переворот — и в покой.
 */
const INSPECT_BAYONET = new VmTrack(
  [
    { t: 0, p: Z, r: Z, kz: 0, kx: 0 },
    { t: 0.12, p: [-0.1, 0.07, 0.02], r: [0.15, 1.05, 0.3], e: 'out' },
    { t: 0.3, p: [-0.1, 0.075, 0.02], r: [0.12, 1.1, 0.38], kz: 0 },
    { t: 0.4, kz: Math.PI, p: [-0.1, 0.085, 0.02], e: 'snap' },
    { t: 0.58, p: [-0.1, 0.075, 0.02], r: [0.1, 1.15, 0.42], kz: Math.PI },
    { t: 0.7, p: [-0.06, 0.06, 0.0], r: [0.6, 0.3, -0.4], e: 'out' },
    { t: 0.8, kz: Math.PI, r: [0.62, 0.28, -0.42] },
    { t: 0.88, kz: TAU, e: 'snap' },
    { t: 1, p: Z, r: Z, kz: TAU, e: 'io' },
  ],
  'io',
);
/**
 * Осмотр керамбита: подъём к центру, два оборота на пальце в кольце, перехват — клинок плашмя,
 * ещё два оборота на опускании и в покой.
 */
const INSPECT_KARAMBIT = new VmTrack(
  [
    { t: 0, p: Z, r: Z, kx: 0, kz: 0 },
    { t: 0.1, p: [-0.07, 0.07, 0.0], r: [0.1, 0.6, 0.2], kx: 0, e: 'out' },
    { t: 0.38, kx: 2 * TAU, p: [-0.07, 0.08, 0.0], e: 'io' },
    { t: 0.48, p: [-0.09, 0.07, 0.02], r: [0.15, 1.1, 0.35], e: 'out' },
    { t: 0.64, p: [-0.09, 0.075, 0.02], r: [0.12, 1.15, 0.42], kx: 2 * TAU },
    { t: 0.7, r: [0.2, 0.5, 0.1], p: [-0.04, 0.05, 0.0] },
    { t: 0.9, kx: 4 * TAU, e: 'io' },
    { t: 1, p: Z, r: Z, kx: 4 * TAU, e: 'io' },
  ],
  'io',
);

/** Осмотр по видам оружия: длительность и кадры. */
export const INSPECT: Record<string, { dur: number; track: VmTrack }> = {
  // длинное: боком к себе, переворот на бок, взгляд на дуло и обратно
  long: {
    dur: 3.4,
    track: inspectTrack([
      [0, 0, 0, 0, 0, 0, 0],
      [0.16, -0.13, 0.05, 0.03, 0.12, 0.95, 0.3],
      [0.36, -0.13, 0.06, 0.03, 0.12, 0.95, 0.42],
      [0.52, -0.09, 0.07, 0.02, -0.25, -0.2, -0.95],
      [0.68, -0.09, 0.07, 0.02, -0.25, -0.2, -1.0],
      [0.82, -0.06, 0.03, -0.02, 0.4, 0.45, 0.05],
      [1, 0, 0, 0, 0, 0, 0],
    ]),
  },
  pistol: {
    dur: 2.8,
    track: inspectTrack([
      [0, 0, 0, 0, 0, 0, 0],
      [0.2, -0.11, 0.06, 0.04, 0.15, 1.1, 0.25],
      [0.45, -0.11, 0.07, 0.04, 0.15, 1.15, 0.35],
      [0.62, -0.08, 0.06, 0.04, -0.1, -0.5, -0.8],
      [0.82, -0.08, 0.05, 0.03, -0.1, -0.55, -0.85],
      [1, 0, 0, 0, 0, 0, 0],
    ]),
  },
  bayonet: { dur: 3.4, track: INSPECT_BAYONET },
  karambit: { dur: 3.6, track: INSPECT_KARAMBIT },
  // граната: подбросить с вращением и поймать
  grenade: {
    dur: 2.4,
    track: inspectTrack([
      [0, 0, 0, 0, 0, 0, 0],
      [0.2, -0.08, 0.02, 0.0, 0.2, 0.6, 0.2],
      [0.42, -0.08, 0.16, -0.02, 0.2 + TAU, 0.6, 0.2],
      [0.6, -0.08, 0.03, 0.0, TAU + 0.25, 0.65, 0.25],
      [1, 0, 0, 0, TAU, 0, 0],
    ]),
  },
};

/** Какой осмотр у оружия в руках. */
export function inspectOf(kind: string, knife: KnifeAnimKind = 'bayonet'): { dur: number; track: VmTrack } {
  if (kind === 'knife') return INSPECT[knife];
  return INSPECT[kind === 'pistol' || kind === 'grenade' ? kind : 'long'];
}
