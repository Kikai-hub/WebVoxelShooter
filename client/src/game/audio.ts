// Звуки (WebAudio). Выстрелы — записи настоящего оружия (public/sounds, по 3 варианта на ствол,
// грузятся в фоне); пока не загрузились — синтезированный выстрел. Шаги, попадания, бомба — синтез.

import { RELOAD_SOUND_NAMES, reloadSteps, type ReloadSoundName } from '../../../shared/src/index';

/**
 * Необязательные наборы файлов: sounds/<папка>/<имя>.mp3 (или .wav); нет файла — играет синтез.
 * <имя>_2, _3… — варианты одного звука, при воспроизведении выбирается случайный.
 */
export const NADE_SOUND_NAMES = ['bounce', 'bounce_2', 'bounce_3', 'bounce_4', 'throw', 'pin', 'he_boom', 'he_boom_far', 'flash_pop', 'smoke_hiss', 'glass_break', 'glass_break_2', 'fire_ignite'] as const;
export type NadeSound = (typeof NADE_SOUND_NAMES)[number];
/** Щелчки перезарядки под конкретный тип оружия: reload/<kind>_<имя>, иначе общий reload/<имя>. */
const RELOAD_KIND_NAMES = ['pistol_mag_in', 'pistol_bolt', 'sniper_bolt', 'smg_bolt'] as const;

/**
 * Нарезка файлов (sounds/nade, sounds/reload; источник — Lots of Sounds, CC0): offset — с какой секунды
 * играть (в начале файла запас тишины от нарезки по кадрам MP3), gain — выравнивание пиков между файлами.
 */
const CLIP: Record<string, { offset: number; gain: number }> = {
  'nade/bounce': { offset: 0.049, gain: 0.66 },
  'nade/bounce_2': { offset: 0.015, gain: 0.4 },
  'nade/bounce_3': { offset: 0.163, gain: 0.36 },
  'nade/bounce_4': { offset: 0.176, gain: 0.33 },
  'nade/he_boom': { offset: 0.015, gain: 0.82 },
  'nade/he_boom_far': { offset: 0.019, gain: 1.06 },
  'nade/flash_pop': { offset: 0.033, gain: 0.71 },
  'nade/smoke_hiss': { offset: 0.17, gain: 1.12 },
  'nade/glass_break': { offset: 0.16, gain: 0.56 },
  'nade/glass_break_2': { offset: 0.223, gain: 1.55 },
  'nade/fire_ignite': { offset: 0.204, gain: 0.46 },
  'reload/mag_out': { offset: 0.176, gain: 0.42 },
  'reload/mag_in': { offset: 0.181, gain: 0.35 },
  'reload/bolt': { offset: 0.085, gain: 0.58 },
  'reload/smg_bolt': { offset: 0.014, gain: 0.25 },
  'reload/pistol_mag_in': { offset: 0.013, gain: 0.25 },
  'reload/pistol_bolt': { offset: 0.014, gain: 0.25 },
  'reload/sniper_bolt': { offset: 0.155, gain: 0.26 },
  'reload/shell': { offset: 0.17, gain: 0.25 },
  'reload/pump': { offset: 0.19, gain: 0.32 },
  'reload/cyl_open': { offset: 0.153, gain: 0.23 },
  'reload/cyl_load': { offset: 0.047, gain: 0.23 },
  'reload/cyl_close': { offset: 0.165, gain: 0.22 },
  // выстрелы (sounds/shots): записи сильно сжаты — громкость подогнана по средней громкости
  // первых 150 мс к студийным записям (public/sounds/*.wav), а не по пикам
  'shots/ump_a': { offset: 0.02, gain: 0.3 },
  'shots/mac10_a': { offset: 0.145, gain: 0.13 },
  'shots/aug_a': { offset: 0.176, gain: 0.19 },
  'shots/aug_b': { offset: 0.165, gain: 0.166 },
  'shots/aug_c': { offset: 0.161, gain: 0.2 },
  'shots/aug_d': { offset: 0.154, gain: 0.168 },
  'shots/skorpion_a': { offset: 0.184, gain: 0.141 },
  'shots/skorpion_b': { offset: 0.087, gain: 0.217 },
  'shots/sawedoff_a': { offset: 0.079, gain: 0.1 },
  'shots/vikhr_a': { offset: 0.02, gain: 0.111 },
  'shots/vikhr_b': { offset: 0.02, gain: 0.112 },
  'shots/vikhr_c': { offset: 0.02, gain: 0.11 },
  // нож: взмах и попадание
  'knife/swing': { offset: 0.037, gain: 3.1 },
  'knife/swing_2': { offset: 0.061, gain: 0.18 },
  'knife/swing_3': { offset: 0.105, gain: 0.2 },
  'knife/hit': { offset: 0.177, gain: 0.77 },
  'knife/hit_2': { offset: 0.041, gain: 0.22 },
};

/**
 * Дополнительные записи выстрелов из sounds/shots (Lots of Sounds, CC0): чередуются со студийными
 * вариантами оружия; у оружия из SHOT_REPLACE студийные (чужого ствола) не играют вовсе.
 */
const SHOT_EXTRA: Record<string, string[]> = {
  ump: ['ump_a'],
  mac10: ['mac10_a'],
  shmel: ['mac10_a'],
  aug: ['aug_a', 'aug_b', 'aug_c', 'aug_d'],
  skorpion: ['skorpion_a', 'skorpion_b'],
  sawedoff: ['sawedoff_a'],
  vikhr: ['vikhr_a', 'vikhr_b', 'vikhr_c'],
};
/** Стволы, которые раньше звучали чужими записями: теперь только свои. */
const SHOT_REPLACE = new Set(['ump', 'mac10', 'aug', 'skorpion']);
const SHOT_EXTRA_FILES = [...new Set(Object.values(SHOT_EXTRA).flat())];

/** Слой синтеза: шум через полосовой/фильтр и/или тон с падением частоты; at — смещение, с. */
interface Layer {
  at: number;
  noise?: { f: number; q?: number; dur: number; vol: number; type?: BiquadFilterType };
  tone?: { f0: number; f1: number; dur: number; vol: number; wave?: OscillatorType };
}

/** Синтез щелчков перезарядки (запасной вариант, если нет файла sounds/reload/<имя>.wav). */
const RELOAD_SYNTH: Record<ReloadSoundName, Layer[]> = {
  mag_out: [{ at: 0, noise: { f: 1800, q: 1.2, dur: 0.05, vol: 0.5, type: 'bandpass' }, tone: { f0: 160, f1: 70, dur: 0.07, vol: 0.5 } }, { at: 0.07, noise: { f: 900, dur: 0.06, vol: 0.25, type: 'bandpass' } }],
  mag_in: [{ at: 0, noise: { f: 2400, q: 1.5, dur: 0.04, vol: 0.5, type: 'bandpass' }, tone: { f0: 220, f1: 110, dur: 0.06, vol: 0.5 } }, { at: 0.06, noise: { f: 3200, q: 2, dur: 0.03, vol: 0.45, type: 'bandpass' }, tone: { f0: 900, f1: 700, dur: 0.03, vol: 0.2, wave: 'square' } }],
  bolt: [{ at: 0, noise: { f: 3000, q: 2, dur: 0.03, vol: 0.5, type: 'bandpass' }, tone: { f0: 1300, f1: 1000, dur: 0.025, vol: 0.2, wave: 'square' } }, { at: 0.1, noise: { f: 2200, q: 2, dur: 0.04, vol: 0.55, type: 'bandpass' }, tone: { f0: 700, f1: 400, dur: 0.05, vol: 0.3 } }],
  pump: [{ at: 0, noise: { f: 1000, q: 1, dur: 0.06, vol: 0.5, type: 'bandpass' }, tone: { f0: 190, f1: 90, dur: 0.07, vol: 0.4 } }, { at: 0.17, noise: { f: 1400, q: 1, dur: 0.06, vol: 0.55, type: 'bandpass' }, tone: { f0: 220, f1: 100, dur: 0.07, vol: 0.45 } }],
  shell: [{ at: 0, noise: { f: 4200, q: 2, dur: 0.02, vol: 0.35, type: 'bandpass' }, tone: { f0: 760, f1: 430, dur: 0.035, vol: 0.28 } }],
  cyl_open: [{ at: 0, noise: { f: 2200, q: 1.5, dur: 0.05, vol: 0.5, type: 'bandpass' }, tone: { f0: 400, f1: 250, dur: 0.05, vol: 0.3 } }],
  cyl_load: [{ at: 0, noise: { f: 3800, q: 2, dur: 0.025, vol: 0.4, type: 'bandpass' }, tone: { f0: 820, f1: 500, dur: 0.04, vol: 0.28 } }],
  cyl_close: [{ at: 0, tone: { f0: 260, f1: 120, dur: 0.07, vol: 0.5 }, noise: { f: 2000, q: 1.2, dur: 0.05, vol: 0.5, type: 'bandpass' } }, { at: 0.05, noise: { f: 3000, q: 2, dur: 0.03, vol: 0.35, type: 'bandpass' } }],
};

/**
 * Ключ оружия → файлы выстрелов (public/sounds/<file>_<i>.wav), громкость относительно самой громкой
 * снайперки и высота тона. file — если оружие берёт записи другого ствола того же калибра.
 */
const SHOT_SOUNDS: Record<string, { n: number; gain: number; file?: string; rate?: number }> = {
  osa: { n: 3, gain: 0.5 },
  gyurza: { n: 3, gain: 0.65 },
  shmel: { n: 1, gain: 0.55 },
  molot: { n: 3, gain: 0.85 },
  vikhr: { n: 3, gain: 0.7 },
  sokol: { n: 3, gain: 1 },
  m4a1: { n: 3, gain: 0.65 },
  aug: { n: 3, gain: 0.66, rate: 0.97 },
  awm: { n: 3, gain: 1 },
  beretta: { n: 3, gain: 0.48 },
  skorpion: { n: 3, gain: 0.45, rate: 1.08 },
  python: { n: 3, gain: 0.62 },
  sw29: { n: 3, gain: 0.72, rate: 0.94 },
  sawedoff: { n: 3, gain: 0.85, rate: 1.04 },
  // .45 ACP — те же записи, что у 1911 (Desert Eagle), со своей высотой
  mac10: { n: 3, gain: 0.5, file: 'gyurza', rate: 1.12 },
  ump: { n: 3, gain: 0.55, file: 'gyurza', rate: 0.96 },
};

/** Звуки раунда: sounds/round/<имя>.wav, если файл есть; иначе короткая мелодия, синтезированная в WebAudio. */
export const ROUND_SOUNDS = ['t_win', 'ct_win', 'mvp', 'match_start', 'round_start'] as const;
export type RoundSound = (typeof ROUND_SOUNDS)[number];

/** Запасные мелодии: [частота Гц, начало с, длительность с], тембр и громкость. */
const ROUND_SYNTH: Record<RoundSound, { wave: OscillatorType; gain: number; notes: Array<[number, number, number]> }> = {
  // нападение — тяжёлая восходящая фраза в миноре
  t_win: { wave: 'sawtooth', gain: 0.16, notes: [[196, 0, 0.22], [233, 0.2, 0.22], [294, 0.4, 0.22], [392, 0.6, 0.9]] },
  // защита — светлый мажорный подъём
  ct_win: { wave: 'triangle', gain: 0.3, notes: [[262, 0, 0.2], [330, 0.18, 0.2], [392, 0.36, 0.2], [523, 0.54, 1.0]] },
  mvp: { wave: 'sine', gain: 0.28, notes: [[659, 0, 0.12], [784, 0.1, 0.12], [988, 0.2, 0.12], [1319, 0.3, 0.7]] },
  match_start: { wave: 'square', gain: 0.1, notes: [[262, 0, 0.18], [262, 0.22, 0.18], [392, 0.44, 0.18], [523, 0.66, 0.5], [392, 1.2, 0.18], [523, 1.42, 0.9]] },
  round_start: { wave: 'square', gain: 0.1, notes: [[523, 0, 0.1], [784, 0.14, 0.28]] },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;
  /** сырые файлы (скачиваются сразу) и раскодированные буферы (после создания AudioContext) */
  private raw = new Map<string, ArrayBuffer>();
  private buffers = new Map<string, AudioBuffer[]>();
  private lastVariant = new Map<string, number>();

  constructor() {
    // скачиваем заранее, пока игрок в меню; раскодируем, когда появится AudioContext
    // файлы общие у стволов одного калибра — грузим каждый набор один раз
    this.loadVoices();
    this.loadRoundSounds();
    this.loadExtra('reload', [...RELOAD_SOUND_NAMES, ...RELOAD_KIND_NAMES]);
    this.loadExtra('nade', NADE_SOUND_NAMES);
    this.loadExtra('shots', SHOT_EXTRA_FILES);
    this.loadExtra('knife', ['swing', 'swing_2', 'swing_3', 'hit', 'hit_2']);
    const files = new Set(Object.entries(SHOT_SOUNDS).map(([k, s]) => s.file ?? k));
    for (const key of files)
      for (let i = 0; i < (SHOT_SOUNDS[key]?.n ?? 3); i++) {
        const name = `${key}_${i}`;
        fetch(`${import.meta.env.BASE_URL}sounds/${name}.wav`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((ab) => {
            this.raw.set(name, ab);
            if (this.ctx) this.decode(name);
          })
          .catch(() => {
            /* нет файла — останется синтезированный звук */
          });
      }
  }

  // ---- Звуки раунда (победа сторон, MVP, начало матча и раунда) ----

  private roundRaw = new Map<string, ArrayBuffer>();
  private roundBuf = new Map<string, AudioBuffer>();

  /** Файлы необязательны: нет sounds/round/<имя>.wav — играет синтез. */
  private loadRoundSounds() {
    for (const name of ROUND_SOUNDS)
      fetch(`${import.meta.env.BASE_URL}sounds/round/${name}.wav`)
        .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => {
          this.roundRaw.set(name, ab);
          if (this.ctx) this.decodeRound(name);
        })
        .catch(() => {});
  }

  private decodeRound(name: string) {
    const ab = this.roundRaw.get(name);
    if (!ab || !this.ctx) return;
    this.roundRaw.delete(name);
    this.ctx
      .decodeAudioData(ab)
      .then((buf) => this.roundBuf.set(name, buf))
      .catch(() => {});
  }

  /** Звук раунда: файл из sounds/round, иначе синтез. */
  roundSound(name: RoundSound) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.02;
    const buf = this.roundBuf.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      src.connect(g).connect(this.master);
      src.start(t0);
      return;
    }
    const def = ROUND_SYNTH[name];
    for (const [freq, at, dur] of def.notes) {
      const osc = ctx.createOscillator();
      osc.type = def.wave;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const s = t0 + at;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(def.gain, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      osc.connect(g).connect(this.master);
      osc.start(s);
      osc.stop(s + dur + 0.05);
    }
  }

  // ---- Необязательные наборы файлов (перезарядка, гранаты): sounds/<папка>/<имя>.wav ----

  private extraRaw = new Map<string, ArrayBuffer>();
  private extraBuf = new Map<string, AudioBuffer>();

  private loadExtra(dir: string, names: readonly string[]) {
    for (const name of names) {
      const key = `${dir}/${name}`;
      const get = (ext: string) =>
        fetch(`${import.meta.env.BASE_URL}sounds/${key}.${ext}`).then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
      get('mp3')
        .catch(() => get('wav'))
        .then((ab) => {
          this.extraRaw.set(key, ab);
          if (this.ctx) this.decodeExtra(key);
        })
        .catch(() => {});
    }
  }

  private decodeExtra(key: string) {
    const ab = this.extraRaw.get(key);
    if (!ab || !this.ctx) return;
    this.extraRaw.delete(key);
    this.ctx
      .decodeAudioData(ab)
      .then((buf) => this.extraBuf.set(key, buf))
      .catch(() => {});
  }

  /**
   * Вход для звука: усиление по расстоянию + панорама + глушение дали. own — свой игрок:
   * громко и без панорамы. Возвращает узел, к которому подключать источник, и задержку звука, с.
   */
  private spatial(ctx: AudioContext, dist: number, pan: number, own: boolean, gain: number, reach = 0.25): { input: AudioNode; delay: number } {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = own ? 20000 : Math.max(900, 20000 / (1 + dist * 0.12));
    const g = ctx.createGain();
    g.gain.value = own ? gain : gain * Math.max(0, 1 / (1 + dist * reach) - 0.01);
    const p = ctx.createStereoPanner();
    p.pan.value = own ? 0 : Math.max(-1, Math.min(1, pan));
    lp.connect(g).connect(p).connect(this.master!);
    return { input: lp, delay: own ? 0 : Math.min(1.2, dist / 343) };
  }

  /** Слои синтеза в момент t на узел out. */
  private playLayers(ctx: AudioContext, layers: Layer[], t: number, out: AudioNode, vol = 1) {
    for (const l of layers) {
      const s = t + l.at;
      if (l.noise && this.noise) {
        const n = l.noise;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = n.type ?? 'bandpass';
        f.frequency.value = n.f;
        f.Q.value = n.q ?? 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(n.vol * vol, s);
        g.gain.exponentialRampToValueAtTime(0.001, s + n.dur);
        src.connect(f).connect(g).connect(out);
        src.start(s, Math.random() * 0.3, n.dur + 0.02);
      }
      if (l.tone) {
        const o = ctx.createOscillator();
        o.type = l.tone.wave ?? 'sine';
        o.frequency.setValueAtTime(l.tone.f0, s);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, l.tone.f1), s + l.tone.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(l.tone.vol * vol, s);
        g.gain.exponentialRampToValueAtTime(0.001, s + l.tone.dur);
        o.connect(g).connect(out);
        o.start(s);
        o.stop(s + l.tone.dur + 0.02);
      }
    }
  }

  /** Файл из sounds/<ключ>.wav, если загружен, на узел out в момент t. */
  /** Есть ли загруженный файл (или его вариант _2…_4). */
  private hasFile(key: string): boolean {
    return this.extraBuf.has(key);
  }

  /**
   * Файл key (или случайный из вариантов key_2…key_4), с нарезкой из CLIP и короткими
   * подъёмом/спадом громкости по краям, чтобы не щёлкало. false — файла нет, нужен синтез.
   */
  private playFile(ctx: AudioContext, key: string, t: number, out: AudioNode, rate = 1): boolean {
    const keys = [key, `${key}_2`, `${key}_3`, `${key}_4`].filter((k) => this.extraBuf.has(k));
    if (!keys.length) return false;
    const k = keys[Math.floor(Math.random() * keys.length)];
    const buf = this.extraBuf.get(k)!;
    const clip = CLIP[k] ?? { offset: 0, gain: 1 };
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const r = rate * (0.97 + Math.random() * 0.06);
    src.playbackRate.value = r;
    const len = Math.max(0.02, (buf.duration - clip.offset) / r);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clip.gain, t + 0.004);
    g.gain.setValueAtTime(clip.gain, t + Math.max(0.005, len - 0.06));
    g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(g).connect(out);
    src.start(t, clip.offset);
    src.stop(t + len + 0.02);
    return true;
  }

  /**
   * Перезарядка: серия щелчков по таблице RELOAD_TIMINGS (доли длительности dur).
   * Свой игрок — громко и без панорамы, чужие — по расстоянию и панораме, как shot().
   */
  reload(kind: string, key: string, dur: number, dist = 0, pan = 0, own = false) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const { input, delay } = this.spatial(ctx, dist, pan, own, own ? 0.7 : 0.55, 0.35);
    const t0 = ctx.currentTime + 0.01 + delay;
    for (const [frac, name] of reloadSteps(kind, key)) {
      const t = t0 + frac * dur;
      // сначала щелчок под тип оружия (reload/pistol_bolt…), потом общий, потом синтез
      if (!this.playFile(ctx, `reload/${kind}_${name}`, t, input) && !this.playFile(ctx, `reload/${name}`, t, input)) this.playLayers(ctx, RELOAD_SYNTH[name], t, input);
    }
  }

  // ---- Гранаты: отскок, бросок, чека, взрыв HE ----

  /** Отскок гранаты: звонкий «дзынь», громче при сильном ударе (speed — скорость удара, м/с). */
  nadeBounce(dist: number, pan: number, speed: number) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const v = Math.min(1, speed / 8);
    const { input, delay } = this.spatial(ctx, dist, pan, false, 0.5 * (0.35 + 0.65 * v), 0.3);
    const t = ctx.currentTime + 0.005 + delay;
    if (this.playFile(ctx, 'nade/bounce', t, input, 0.9 + v * 0.2)) return;
    this.playLayers(ctx, [{ at: 0, tone: { f0: 2600, f1: 1700, dur: 0.07, vol: 0.35, wave: 'triangle' }, noise: { f: 3400, q: 1.5, dur: 0.05, vol: 0.5, type: 'bandpass' } }, { at: 0.012, tone: { f0: 4100, f1: 3000, dur: 0.04, vol: 0.12 } }], t, input);
  }

  /** Выдёргивание чеки у своего игрока (кнопка броска зажата). */
  nadePin() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const { input } = this.spatial(ctx, 0, 0, true, 0.6);
    const t = ctx.currentTime + 0.005;
    if (this.playFile(ctx, 'nade/pin', t, input)) return;
    this.playLayers(ctx, [{ at: 0, noise: { f: 3600, q: 3, dur: 0.03, vol: 0.5, type: 'bandpass' }, tone: { f0: 1500, f1: 1100, dur: 0.03, vol: 0.2, wave: 'square' } }, { at: 0.07, noise: { f: 2600, q: 2, dur: 0.05, vol: 0.4, type: 'bandpass' }, tone: { f0: 400, f1: 200, dur: 0.05, vol: 0.3 } }], t, input);
  }

  /** Бросок: взмах руки. Чужой бросок — по расстоянию и панораме. */
  nadeThrow(dist = 0, pan = 0, own = true) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const { input, delay } = this.spatial(ctx, dist, pan, own, own ? 0.6 : 0.4, 0.35);
    const t = ctx.currentTime + 0.005 + delay;
    if (this.playFile(ctx, 'nade/throw', t, input)) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(f).connect(g).connect(input);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** Взрыв HE: низкий бум, средний треск и хвост; с расстоянием — тише, глуше и позже. */
  heBoom(dist: number, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const { input, delay } = this.spatial(ctx, dist, pan, false, 1.1, 0.06);
    const t = ctx.currentTime + 0.01 + delay;
    // издалека — отдельная запись глухого взрыва (если есть)
    if (dist > 30 && this.hasFile('nade/he_boom_far') && this.playFile(ctx, 'nade/he_boom_far', t, input)) return;
    if (this.playFile(ctx, 'nade/he_boom', t, input)) return;
    // бум: падающий низкий тон
    this.playLayers(ctx, [{ at: 0, tone: { f0: 110, f1: 32, dur: 0.9, vol: 1.0 } }, { at: 0, noise: { f: 260, dur: 0.7, vol: 0.9, type: 'lowpass' } }, { at: 0, noise: { f: 2500, dur: 0.16, vol: 0.8, type: 'highpass' } }, { at: 0.03, noise: { f: 1100, q: 0.7, dur: 0.35, vol: 0.55, type: 'bandpass' } }], t, input);
    // хвост: гул, затухающий вместе с понижением частоты
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t + 0.1);
    f.frequency.exponentialRampToValueAtTime(70, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
    src.connect(f).connect(g).connect(input);
    src.start(t + 0.1);
    src.stop(t + 2.4);
  }

  // ---- Комментатор: First Blood, серии убийств, Headshot ----

  /** громкость реплик комментатора (доля от общей) */
  static readonly ANNOUNCER_GAIN = 0.2;
  private voiceRaw = new Map<string, ArrayBuffer>();
  private voice = new Map<string, AudioBuffer>();
  /** когда освободится «голос»: реплики идут по очереди, не накладываясь */
  private voiceUntil = 0;

  private loadVoices() {
    for (const name of ['firstblood', 'doublekill', 'triplekill', 'megakill', 'rampage', 'headshot'])
      fetch(`${import.meta.env.BASE_URL}sounds/announcer/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => {
          this.voiceRaw.set(name, ab);
          if (this.ctx) this.decodeVoice(name);
        })
        .catch(() => {});
  }

  private decodeVoice(name: string) {
    const ab = this.voiceRaw.get(name);
    if (!ab || !this.ctx) return;
    this.voiceRaw.delete(name);
    this.ctx
      .decodeAudioData(ab)
      .then((buf) => this.voice.set(name, buf))
      .catch(() => {});
  }

  /** Реплика комментатора (громкость 20%); если голос занят — сразу после предыдущей. */
  announce(name: string) {
    const ctx = this.ensure();
    const buf = this.voice.get(name);
    if (!ctx || !buf) return;
    const start = Math.max(ctx.currentTime, this.voiceUntil);
    // очередь не копим: старые реплики уже неактуальны
    if (start - ctx.currentTime > 2.5) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Sfx.ANNOUNCER_GAIN;
    src.connect(g).connect(this.master!);
    src.start(start);
    this.voiceUntil = start + buf.duration + 0.05;
  }

  private decode(name: string) {
    const ab = this.raw.get(name);
    if (!ab || !this.ctx) return;
    this.raw.delete(name);
    const key = name.slice(0, name.lastIndexOf('_'));
    this.ctx
      .decodeAudioData(ab)
      .then((buf) => {
        const list = this.buffers.get(key) ?? [];
        list.push(buf);
        this.buffers.set(key, list);
      })
      .catch(() => {});
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        for (const name of [...this.raw.keys()]) this.decode(name);
        for (const name of [...this.voiceRaw.keys()]) this.decodeVoice(name);
        for (const name of [...this.roundRaw.keys()]) this.decodeRound(name);
        for (const name of [...this.extraRaw.keys()]) this.decodeExtra(name);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = this.volume;
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  /**
   * Выстрел. key — оружие (osa, vikhr…), kind — вид (для запасного синтеза), dist — до слушателя, м.
   * Запись: вариант не повторяется подряд, высота чуть плавает, вдали — тише и глуше.
   */
  shot(kind: string, dist = 0, pan = 0, key = '') {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    if (kind === 'knife') return this.knifeSwing(dist, pan);
    const conf = SHOT_SOUNDS[key];
    const bufs = conf && !SHOT_REPLACE.has(key) ? (this.buffers.get(conf.file ?? key) ?? []) : [];
    const extras = (SHOT_EXTRA[key] ?? []).map((n) => `shots/${n}`).filter((k) => this.extraBuf.has(k));
    const total = bufs.length + extras.length;
    if (total && conf) {
      let v = Math.floor(Math.random() * total);
      if (total > 1 && v === this.lastVariant.get(key)) v = (v + 1) % total;
      this.lastVariant.set(key, v);
      // звук идёт со скоростью звука: далёкий выстрел слышен чуть позже
      const t = ctx.currentTime + Math.min(0.25, dist / 343);
      // расстояние: громкость падает, высокие частоты гаснут быстрее
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(900, 20000 / (1 + dist * 0.09));
      const g = ctx.createGain();
      g.gain.value = conf.gain * Math.max(0.04, 1 / (1 + dist * 0.1));
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      lp.connect(g).connect(p).connect(this.master!);
      if (v >= bufs.length) {
        this.playFile(ctx, extras[v - bufs.length], t, lp, conf.rate ?? 1);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = bufs[v];
      src.playbackRate.value = (conf.rate ?? 1) * (0.96 + Math.random() * 0.08);
      src.connect(lp);
      src.start(t);
      return;
    }
    const vol = Math.max(0.03, 1 / (1 + dist * 0.12)) * (kind === 'sniper' ? 1.3 : kind === 'pistol' ? 0.7 : 1);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = (kind === 'shotgun' ? 2200 : kind === 'sniper' ? 2600 : 3800) / (1 + dist * 0.03);
    const g = ctx.createGain();
    const dur = kind === 'sniper' ? 0.45 : kind === 'shotgun' ? 0.35 : 0.16;
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.master!);
    src.start(t, Math.random() * 0.2, dur);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'pistol' ? 160 : 110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(p);
    o.start(t);
    o.stop(t + 0.15);
  }

  click(freq = 900, dur = 0.04, vol = 0.25) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur);
  }

  hit(headshot: boolean) {
    this.click(headshot ? 1800 : 1200, 0.05, 0.18);
  }

  step(dist: number, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const vol = 0.22 / (1 + dist * 0.25);
    if (vol < 0.01) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500 + Math.random() * 200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.master!);
    src.start(t, Math.random() * 0.3, 0.09);
  }

  private noiseBurst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  grenade(dist: number, pan = 0) {
    this.heBoom(dist, pan);
  }

  /** Запись из sounds/nade с затуханием по расстоянию (без панорамы — вызовы передают только дистанцию). */
  private nadeFile(key: string, dist: number, gain: number, reach: number): boolean {
    const ctx = this.ensure();
    if (!ctx) return false;
    if (!this.hasFile(key)) return false;
    const { input, delay } = this.spatial(ctx, dist, 0, false, gain, reach);
    return this.playFile(ctx, key, ctx.currentTime + 0.01 + delay, input);
  }

  /** Взмах ножом (случайная из записей knife/swing*); нет файлов — короткий синтезированный свист. */
  knifeSwing(dist = 0, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const own = dist === 0;
    const { input, delay } = this.spatial(ctx, dist, pan, own, own ? 0.8 : 0.6, 0.35);
    const t = ctx.currentTime + 0.005 + delay;
    if (this.playFile(ctx, 'knife/swing', t, input)) return;
    this.playLayers(ctx, [{ at: 0, noise: { f: 1400, q: 0.8, dur: 0.16, vol: 0.4, type: 'bandpass' } }], t, input);
  }

  /** Нож попал: удар лезвия (knife/hit*) в точке попадания. */
  knifeHit(dist = 0, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const own = dist === 0;
    const { input, delay } = this.spatial(ctx, dist, pan, own, own ? 0.9 : 0.7, 0.3);
    const t = ctx.currentTime + 0.005 + delay;
    if (this.playFile(ctx, 'knife/hit', t, input)) return;
    this.playLayers(ctx, [{ at: 0, noise: { f: 600, dur: 0.08, vol: 0.5, type: 'lowpass' }, tone: { f0: 180, f1: 80, dur: 0.08, vol: 0.4 } }], t, input);
  }

  flashbang(dist: number) {
    const v = Math.max(0.06, 0.8 / (1 + dist * 0.08));
    // хлопок — запись, звон поверх — синтез
    if (!this.nadeFile('nade/flash_pop', dist, 1, 0.08)) this.noiseBurst(0.35, 4000, v, 'highpass');
    this.click(3800, 0.9, v * 0.25);
  }

  /** Звон разбитой бутылки / хлопок зажигательной. */
  glassBreak(dist: number) {
    if (this.nadeFile('nade/glass_break', dist, 1, 0.1)) return;
    const v = Math.max(0.05, 0.6 / (1 + dist * 0.1));
    this.noiseBurst(0.25, 5000, v, 'highpass');
    this.click(2600, 0.12, v * 0.2);
  }

  /** Огонь: вспышка (запись, если есть), затем гул и треск на всё время горения, тише с расстоянием. */
  fire(dist: number, dur: number) {
    const v = Math.max(0.02, 0.35 / (1 + dist * 0.12));
    if (!this.nadeFile('nade/fire_ignite', dist, 1, 0.12)) this.noiseBurst(0.4, 1800, v * 1.4);
    this.noiseBurst(dur, 700, v, 'lowpass');
    this.noiseBurst(dur, 3200, v * 0.35, 'bandpass');
  }

  smoke(dist: number) {
    if (this.nadeFile('nade/smoke_hiss', dist, 1, 0.1)) return;
    this.noiseBurst(2.5, 2500, Math.max(0.03, 0.25 / (1 + dist * 0.1)), 'bandpass');
  }

  beep() {
    this.click(1500, 0.08, 0.2);
  }

  explosion() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 2.3);
  }
}
