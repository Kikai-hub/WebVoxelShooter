// Звуки (WebAudio). Выстрелы — записи настоящего оружия (public/sounds, по 3 варианта на ствол,
// грузятся в фоне); пока не загрузились — синтезированный выстрел. Шаги, попадания, бомба — синтез.

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
    const bufs = this.buffers.get(SHOT_SOUNDS[key]?.file ?? key);
    const conf = SHOT_SOUNDS[key];
    if (bufs?.length && conf) {
      let v = Math.floor(Math.random() * bufs.length);
      if (bufs.length > 1 && v === this.lastVariant.get(key)) v = (v + 1) % bufs.length;
      this.lastVariant.set(key, v);
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = bufs[v];
      src.playbackRate.value = (conf.rate ?? 1) * (0.96 + Math.random() * 0.08);
      // расстояние: громкость падает, высокие частоты гаснут быстрее
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(900, 20000 / (1 + dist * 0.09));
      const g = ctx.createGain();
      g.gain.value = conf.gain * Math.max(0.04, 1 / (1 + dist * 0.1));
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(lp).connect(g).connect(p).connect(this.master!);
      // звук идёт со скоростью звука: далёкий выстрел слышен чуть позже
      src.start(t + Math.min(0.25, dist / 343));
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

  grenade(dist: number) {
    this.noiseBurst(1.1, 900 / (1 + dist * 0.03), Math.max(0.08, 1 / (1 + dist * 0.08)));
  }

  flashbang(dist: number) {
    const v = Math.max(0.06, 0.8 / (1 + dist * 0.08));
    this.noiseBurst(0.35, 4000, v, 'highpass');
    this.click(3800, 0.9, v * 0.25);
  }

  /** Звон разбитой бутылки / хлопок зажигательной. */
  glassBreak(dist: number) {
    const v = Math.max(0.05, 0.6 / (1 + dist * 0.1));
    this.noiseBurst(0.25, 5000, v, 'highpass');
    this.click(2600, 0.12, v * 0.2);
  }

  /** Огонь: гул и треск на всё время горения, тише с расстоянием. */
  fire(dist: number, dur: number) {
    const v = Math.max(0.02, 0.35 / (1 + dist * 0.12));
    this.noiseBurst(0.4, 1800, v * 1.4);
    this.noiseBurst(dur, 700, v, 'lowpass');
    this.noiseBurst(dur, 3200, v * 0.35, 'bandpass');
  }

  smoke(dist: number) {
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
