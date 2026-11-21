// Вид карты сверху в PNG (для проверки планировки): цвет — материал, яркость — высота,
// красная рамка — точка, синие/жёлтые — базы. Запуск: npx tsx tools/mapshot.ts wm_market out.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MAPS, MAT } from '../shared/src/index';

const id = process.argv[2] ?? 'wm_market';
const out = process.argv[3] ?? `${id}.png`;
const info = MAPS[id]();
const m = info.map;
const S = 8; // пикселей на воксель
const W = m.sx * S,
  H = m.sz * S;
const img = Buffer.alloc(W * H * 3);
const col: Record<number, [number, number, number]> = {
  [MAT.SAND]: [205, 180, 130],
  [MAT.BRICK]: [170, 95, 70],
  [MAT.COBBLE]: [120, 115, 105],
  [MAT.CRATE]: [150, 105, 55],
  [MAT.DARK]: [60, 55, 50],
  [MAT.SITE]: [200, 60, 50],
  [MAT.TRUNK]: [110, 80, 50],
  [MAT.LEAVES]: [70, 140, 60],
  [MAT.WATER]: [60, 120, 200],
  [MAT.TILE]: [180, 170, 150],
  [MAT.PLASTER]: [225, 215, 195],
  [MAT.WOOD]: [140, 95, 55],
  [MAT.METAL]: [140, 140, 150],
  [MAT.ROOF]: [160, 70, 55],
  [MAT.GROUND]: [190, 165, 120],
  [MAT.ROCK]: [130, 120, 110],
};
for (let z = 0; z < m.sz; z++)
  for (let x = 0; x < m.sx; x++) {
    let y = m.sy - 1;
    while (y > 0 && m.get(x, y, z) === 0) y--;
    const mat = m.get(x, y, z);
    const c = col[mat] ?? [255, 0, 255];
    // крыши выше 6 м рисуем полупрозрачно светлее, чтобы видеть стены
    const k = 0.45 + Math.min(1, y / 16) * 0.75;
    for (let dy = 0; dy < S; dy++)
      for (let dx = 0; dx < S; dx++) {
        // север (большие z) — вверху картинки
        const px = x * S + dx,
          py = (m.sz - 1 - z) * S + dy;
        const o = (py * W + px) * 3;
        const edge = dx === 0 || dy === 0;
        for (let i = 0; i < 3; i++) img[o + i] = Math.min(255, c[i] * k * (edge && y > 1 ? 0.85 : 1));
      }
  }
function rect(r: { x0: number; z0: number; x1: number; z1: number }, c: [number, number, number]) {
  const px0 = Math.round(r.x0 * 2 * S),
    px1 = Math.round(r.x1 * 2 * S) - 1;
  const py0 = Math.round((m.sz - r.z1 * 2) * S),
    py1 = Math.round((m.sz - r.z0 * 2) * S) - 1;
  for (let t = 0; t < 3; t++) {
    for (let x = px0; x <= px1; x++)
      for (const y of [py0 + t, py1 - t]) if (y >= 0 && y < H && x >= 0 && x < W) img.set(c, (y * W + x) * 3);
    for (let y = py0; y <= py1; y++)
      for (const x of [px0 + t, px1 - t]) if (y >= 0 && y < H && x >= 0 && x < W) img.set(c, (y * W + x) * 3);
  }
}
rect(info.sites[0], [255, 40, 40]);
rect(info.spawnZones[0], [255, 220, 60]);
rect(info.spawnZones[1], [60, 140, 255]);

// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b: Buffer) => {
  let c = -1;
  for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (t: string, d: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(out, W, 'x', H);
