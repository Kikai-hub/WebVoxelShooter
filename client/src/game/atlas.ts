// Процедурный атлас пиксельных текстур 16×16 для материалов карты.
// Ряд 0 — боковые грани, ряд 1 — верхние. Фильтрация «ближайший пиксель».

import * as THREE from 'three';
import { MAT, MAT_COUNT, hash32 } from '../../../shared/src/index';

export const TILE = 16;
export const ATLAS_COLS = MAT_COUNT;

type Px = (x: number, y: number, r: (n: number) => number) => number;

function rgb(c: number, k = 1): [number, number, number] {
  return [Math.min(255, ((c >> 16) & 255) * k), Math.min(255, ((c >> 8) & 255) * k), Math.min(255, (c & 255) * k)];
}

const noise = (r: (n: number) => number, amp: number) => 1 - amp + r(1) * amp * 2;

const bricks =
  (base: number, mortar: number, bw: number, bh: number, amp: number): Px =>
  (x, y, r) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const bx = (x + off) % bw;
    if (y % bh === bh - 1 || bx === bw - 1) return mortar;
    return base | (Math.floor(noise(r, amp) * 100) << 24);
  };

const PATTERNS: Record<number, { side: Px; top?: Px }> = {
  [MAT.SAND]: { side: bricks(0xd8b27a, 0xb08c58, 8, 4, 0.06), top: (x, y, r) => 0xdcb886 | (Math.floor(noise(r, 0.05) * 100) << 24) },
  [MAT.BRICK]: { side: bricks(0xb4603e, 0x8a7a66, 6, 3, 0.1) },
  [MAT.COBBLE]: {
    side: (x, y, r) => 0xb9ab92 | (Math.floor(noise(r, 0.06) * 100) << 24),
    top: (x, y, r) => {
      const cx = (x + (Math.floor(y / 4) % 2) * 2) % 4,
        cy = y % 4;
      if (cx === 0 || cy === 0) return 0x9a8c74;
      return 0xcfc2a6 | (Math.floor(noise(r, 0.07) * 100) << 24);
    },
  },
  [MAT.CRATE]: {
    side: (x, y, r) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return 0x5d5f63;
      if (y === 7 || y === 8) return 0xe07a1f;
      if (x === y || x === 15 - y) return 0x7a5530;
      return (y % 4 === 3 ? 0x7d5a35 : 0x9c7246) | (Math.floor(noise(r, 0.06) * 100) << 24);
    },
  },
  [MAT.DARK]: { side: (x, y, r) => 0x3a3129 | (Math.floor(noise(r, 0.1) * 100) << 24) },
  [MAT.SITE]: {
    side: (x, y, r) => 0xb9ab92,
    top: (x, y, r) => ((x + y) % 8 < 4 ? 0xd9893a : 0xc9a46e) | (Math.floor(noise(r, 0.05) * 100) << 24),
  },
  [MAT.TRUNK]: { side: (x, y, r) => (x % 4 === 0 ? 0x6b4a2a : 0x8a6238) | (Math.floor(noise(r, 0.08) * 100) << 24) },
  [MAT.LEAVES]: { side: (x, y, r) => (r(2) > 0.7 ? 0x3e8a2e : 0x2f7424) | (Math.floor(noise(r, 0.1) * 100) << 24) },
  [MAT.WATER]: { side: (x, y, r) => 0x3d8fbf, top: (x, y, r) => (r(3) > 0.85 ? 0x9fd6f0 : 0x4a9fd0) },
  [MAT.TILE]: {
    side: bricks(0xc7b08a, 0xa08a66, 16, 8, 0.03),
    top: (x, y, r) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 0xd8c7a6 : 0xb7744a) | (Math.floor(noise(r, 0.03) * 100) << 24),
  },
  [MAT.PLASTER]: { side: (x, y, r) => 0xe6d4b0 | (Math.floor(noise(r, 0.04) * 100) << 24) },
  [MAT.WOOD]: { side: (x, y, r) => (y % 3 === 2 ? 0x5e3e22 : 0x80583a) | (Math.floor(noise(r, 0.06) * 100) << 24) },
  [MAT.METAL]: { side: (x, y, r) => 0x6f767c | (Math.floor(noise(r, 0.05) * 100) << 24) },
  [MAT.ROOF]: { side: (x, y, r) => (y % 4 === 3 ? 0x8c3b25 : 0xb24f30) | (Math.floor(noise(r, 0.06) * 100) << 24) },
};

export function buildAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * TILE;
  c.height = TILE * 2;
  const g = c.getContext('2d')!;
  const img = g.createImageData(c.width, c.height);
  for (let m = 1; m < MAT_COUNT; m++) {
    const pat = PATTERNS[m] ?? { side: () => 0xff00ff };
    for (let row = 0; row < 2; row++) {
      const fn = row === 1 && pat.top ? pat.top : pat.side;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const seed = m * 7919 + row * 104729 + x * 31 + y * 977;
          const r = (n: number) => hash32(seed * 13 + n) / 4294967296;
          const v = fn(x, y, r);
          const k = (v >>> 24) / 100 || 1;
          const [rr, gg, bb] = rgb(v & 0xffffff, k);
          const o = ((row * TILE + y) * c.width + m * TILE + x) * 4;
          img.data[o] = rr;
          img.data[o + 1] = gg;
          img.data[o + 2] = bb;
          img.data[o + 3] = 255;
        }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Средний цвет материала (для миникарты и осколков). */
export const MAT_COLORS: Record<number, number> = {
  [MAT.SAND]: 0xd8b27a,
  [MAT.BRICK]: 0xb4603e,
  [MAT.COBBLE]: 0xc2b498,
  [MAT.CRATE]: 0x9c7246,
  [MAT.DARK]: 0x3a3129,
  [MAT.SITE]: 0xd9893a,
  [MAT.TRUNK]: 0x8a6238,
  [MAT.LEAVES]: 0x2f7424,
  [MAT.WATER]: 0x4a9fd0,
  [MAT.TILE]: 0xc7a684,
  [MAT.PLASTER]: 0xe6d4b0,
  [MAT.WOOD]: 0x80583a,
  [MAT.METAL]: 0x6f767c,
  [MAT.ROOF]: 0xb24f30,
};
