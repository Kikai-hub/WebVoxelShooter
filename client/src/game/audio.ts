// Синтезированные звуки (WebAudio): выстрелы, шаги, попадания, бомба.
// Без внешних файлов, чтобы клиент оставался лёгким.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;

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

  /** Выстрел: шумовой удар + низкий «бум». dist — расстояние до слушателя. */
  shot(kind: string, dist = 0, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
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
