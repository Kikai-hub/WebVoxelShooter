// Импорт звуков выстрелов из сырых студийных записей (WAV 192 кГц / 24 бит, стерео)
// в лёгкие файлы для браузера: моно, 48 кГц, 16 бит, начало точно по выстрелу, хвост с затуханием.
// Запуск: npx tsx tools/importWeaponSounds.ts "<папка Master Tracks>" [ключи через запятую]
// Результат: client/public/sounds/<оружие>_<n>.wav

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Оружие игры → папка записей, выстрелы «файл@секунда», длина звука (с).
 * В архиве вперемешку выстрелы и механика (затвор, магазин); выстрелы найдены по спектру:
 * у выстрела 30–50% энергии ниже 250 Гц и хвост эха, у щелчков механики — 5–12% и почти без хвоста.
 */
const PLAN: Record<string, { dir: string; shots: string[]; len: number }> = {
  osa: { dir: 'Walther PPQ', shots: ['X_33@0.932', 'X_31@1.084', 'X_35@1.334'], len: 0.7 },
  gyurza: { dir: '1911', shots: ['A_39@1.044', 'A_40@0.984', 'A_39@5.116'], len: 0.8 },
  // у PPSh в архиве почти только очереди (второй выстрел через 0,1 с); одиночный — один
  shmel: { dir: 'PPSh', shots: ['P_20@1.458'], len: 0.45 },
  molot: { dir: 'Nova', shots: ['O_20@1.14', 'O_20@5.214', 'O_16@1.162'], len: 1.1 },
  vikhr: { dir: 'AK-47', shots: ['C_18@1.166', 'C_17@0.34', 'C_32@0.73'], len: 0.6 },
  sokol: { dir: 'Mosin Nagant', shots: ['M_25@1.098', 'M_23@1.004', 'M_25@9.384'], len: 1.4 },
  m4a1: { dir: 'AR-15', shots: ['D_29@0.634', 'D_27@0.502', 'D_24@0.582'], len: 0.6 },
  aug: { dir: 'AR-15', shots: ['D_29@5.576', 'D_27@4.786', 'D_23@0.524'], len: 0.6 },
  awm: { dir: 'Arisaka', shots: ['E_19@0.34', 'E_17@4.2', 'E_23@0.426'], len: 1.4 },
  beretta: { dir: 'Bersa', shots: ['F_45@0.48', 'F_44@0.528', 'F_43@0.42'], len: 0.7 },
  skorpion: { dir: 'Bersa', shots: ['F_45@4.554', 'F_44@5.97', 'F_18@0.674'], len: 0.45 },
  python: { dir: 'Smith & Wesson 642', shots: ['V_24@0.818', 'V_26@0.742', 'V_23@5.588'], len: 0.8 },
  sw29: { dir: 'Ruger Single Six', shots: ['S_18@0.606', 'S_17@0.96', 'S_15@0.772'], len: 0.8 },
  sawedoff: { dir: 'Mossberg', shots: ['N_29@1.618', 'N_27@13.864', 'N_25@18.332'], len: 1.0 },
};
const OUT_RATE = 48000;
const OUT_DIR = 'client/public/sounds';

function readWav(file: string): { rate: number; mono: Float32Array } {
  const b = readFileSync(file);
  let o = 12;
  let fmt: { tag: number; ch: number; rate: number; bits: number } | null = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data' && fmt) {
      const bps = fmt.bits / 8;
      const n = Math.floor(Math.min(sz, b.length - o - 8) / bps / fmt.ch);
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const p = o + 8 + (i * fmt.ch + c) * bps;
          s += fmt.bits === 16 ? b.readInt16LE(p) / 32768 : fmt.bits === 24 ? b.readIntLE(p, 3) / 8388608 : fmt.tag === 3 ? b.readFloatLE(p) : b.readInt32LE(p) / 2147483648;
        }
        mono[i] = s / fmt.ch;
      }
      return { rate: fmt.rate, mono };
    }
    o += 8 + sz + (sz & 1);
  }
  throw new Error('не WAV: ' + file);
}

/** Понижение частоты в целое число раз с фильтром (окно Блэкмана, срез чуть ниже новой Найквиста). */
function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor === 1) return x;
  const taps = 16 * factor + 1;
  const fc = 0.45 / factor;
  const h = new Float32Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let j = 0; j < out.length; j++) {
    const c = j * factor;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const idx = c + k - m;
      if (idx >= 0 && idx < x.length) acc += x[idx] * h[k];
    }
    out[j] = acc;
  }
  return out;
}

/** Начало выстрела около времени at (±60 мс): от пика в окне назад до 10% его уровня. */
function onset(x: Float32Array, rate: number, at: number): number {
  const a = Math.max(0, Math.round((at - 0.06) * rate)),
    b = Math.min(x.length, Math.round((at + 0.06) * rate));
  let peak = 0,
    pi = a;
  for (let i = a; i < b; i++)
    if (Math.abs(x[i]) > peak) {
      peak = Math.abs(x[i]);
      pi = i;
    }
  // первый фронт выше 40% пика в окне, затем назад до 10%
  let first = pi;
  for (let i = a; i < pi; i++)
    if (Math.abs(x[i]) > peak * 0.4) {
      first = i;
      break;
    }
  let s = first;
  while (s > a && Math.abs(x[s]) > peak * 0.1) s--;
  return s;
}

function writeWav16(file: string, x: Float32Array, rate: number) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(file, b);
}

const src = process.argv[2];
if (!src) {
  console.error('Укажите папку Master Tracks из архива Raw Master Tracks');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
// третий аргумент — только эти стволы через запятую (остальные файлы не трогаем)
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
for (const [key, p] of Object.entries(PLAN)) {
  if (only && !only.has(key)) continue;
  p.shots.forEach((shot, n) => {
    const [name, at] = shot.split('@');
    const w = readWav(join(src, p.dir, name + '.wav'));
    const factor = Math.round(w.rate / OUT_RATE);
    // фильтруем только нужный кусок записи (длинные файлы — до 40 МБ)
    const from = Math.max(0, Math.round((+at - 0.2) * w.rate)),
      to = Math.min(w.mono.length, Math.round((+at + p.len + 0.2) * w.rate));
    const x = decimate(w.mono.subarray(from, to), factor);
    const rate = Math.round(w.rate / factor);
    const pre = Math.round(rate * 0.004);
    const s0 = Math.max(0, onset(x, rate, +at - from / w.rate) - pre);
    const len = Math.min(x.length - s0, Math.round(rate * p.len));
    const y = x.slice(s0, s0 + len);
    // убрать постоянную составляющую, плавное начало (1 мс) и затухание последней трети
    let mean = 0;
    for (const v of y) mean += v;
    mean /= y.length;
    const fadeIn = Math.round(rate * 0.001);
    const fadeStart = Math.floor(len * 0.66);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      let v = y[i] - mean;
      if (i < fadeIn) v *= i / fadeIn;
      if (i > fadeStart) {
        const t = (i - fadeStart) / (len - fadeStart);
        v *= Math.pow(1 - t, 2);
      }
      y[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    // одинаковый пик у всех вариантов (−1 дБ); громкость между стволами задаёт игра
    const g = 0.89 / Math.max(peak, 1e-6);
    for (let i = 0; i < len; i++) y[i] *= g;
    const file = join(OUT_DIR, `${key}_${n}.wav`);
    writeWav16(file, y, rate);
    total += 44 + len * 2;
    // проверка, что это выстрел, а не механика: доля энергии ниже 250 Гц в первых 50 мс
    const lpA = Math.exp((-2 * Math.PI * 250) / rate);
    let lp = 0,
      eLow = 0,
      eAll = 0;
    for (let i = 0; i < Math.min(len, rate * 0.05); i++) {
      lp = lpA * lp + (1 - lpA) * y[i];
      eLow += lp * lp;
      eAll += y[i] * y[i];
    }
    const low = Math.sqrt(eLow / eAll);
    console.log(`${file}: ${p.dir}/${shot}, ${(len / rate).toFixed(2)} с, ${((44 + len * 2) / 1024).toFixed(0)} КБ, низ ${(low * 100).toFixed(0)}%${low < 0.25 ? '  ← ВНИМАНИЕ: похоже на механику, а не выстрел' : ''}`);
  });
}
console.log(`Всего ${(total / 1024 / 1024).toFixed(2)} МБ`);
