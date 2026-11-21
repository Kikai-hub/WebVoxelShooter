// Меш карты: один меш на чанк 16³, только видимые грани, запечённое
// затенение в углах (AO) в цвете вершин, пиксельный атлас.
// Сколы: сколотый блок выпадает из основного меша и рисуется из под-вокселей 4×4×4
// (отдельный меш на чанк), текстура при этом продолжается без шва.

import * as THREE from 'three';
import { MAT, SUB, SUB_SIZE, VOXEL, VoxelMap, applyChip, blockKey, type ChipOp } from '../../../shared/src/index';
import { ATLAS_COLS, TILE, buildAtlas } from './atlas';

const CHUNK = 16;

// 6 граней: нормаль, 4 угла (против часовой снаружи), оси для UV
const FACES: Array<{ n: [number, number, number]; c: Array<[number, number, number]>; u: number; v: number; top: boolean; shade: number }> = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], u: 2, v: 1, top: false, shade: 0.86 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], u: 2, v: 1, top: false, shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], u: 0, v: 2, top: true, shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 0, v: 2, top: true, shade: 0.6 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], u: 0, v: 1, top: false, shade: 0.93 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], u: 0, v: 1, top: false, shade: 0.93 },
];

const DU = 1 / ATLAS_COLS;
const PAD = 0.5 / (ATLAS_COLS * TILE);

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  clear() {
    this.pos.length = this.nor.length = this.uv.length = this.col.length = this.idx.length = 0;
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function jitterOf(x: number, y: number, z: number): number {
  return 0.93 + ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100) / 1000;
}

function uvOf(m: number, top: boolean, uu: number, vv: number): [number, number] {
  const row = top && m !== MAT.LEAVES ? 1 : 0;
  return [m * DU + PAD + uu * (DU - 2 * PAD), 1 - row * 0.5 - (0.5 - PAD) + vv * (0.5 - 2 * PAD)];
}

export class MapRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  /** маски сколотых блоков: 64 под-вокселя, 1 — выбит */
  private masks = new Map<number, Uint8Array>();
  private blocksInChunk = new Map<number, Set<number>>();
  private main = new Map<number, THREE.Mesh>();
  private chipMesh = new Map<number, THREE.Mesh>();
  private dirtyMain = new Set<number>();
  private dirtyChip = new Set<number>();
  private buf = new Buf();
  private ncx: number;
  private ncz: number;
  /** время последней перестройки чанка, мс (для замеров) */
  lastRebuildMs = 0;

  constructor(readonly map: VoxelMap) {
    this.material = new THREE.MeshLambertMaterial({ map: buildAtlas(), vertexColors: true });
    this.ncx = Math.ceil(map.sx / CHUNK);
    this.ncz = Math.ceil(map.sz / CHUNK);
    for (let cy = 0; cy < Math.ceil(map.sy / CHUNK); cy++)
      for (let cz = 0; cz < this.ncz; cz++) for (let cx = 0; cx < this.ncx; cx++) this.rebuildMain(this.chunkKey(cx, cy, cz));
  }

  private chunkKey(cx: number, cy: number, cz: number): number {
    return cx + this.ncx * (cz + this.ncz * cy);
  }

  private chunkOfBlock(x: number, y: number, z: number): number {
    return this.chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK));
  }

  private setMesh(store: Map<number, THREE.Mesh>, key: number, g: THREE.BufferGeometry | null) {
    const old = store.get(key);
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      store.delete(key);
    }
    if (!g) return;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    store.set(key, mesh);
  }

  // ---------- Основной меш чанка ----------

  private rebuildMain(key: number) {
    const map = this.map;
    const cx = key % this.ncx,
      cz = Math.floor(key / this.ncx) % this.ncz,
      cy = Math.floor(key / (this.ncx * this.ncz));
    const b = this.buf;
    b.clear();
    const solid = (x: number, y: number, z: number) => (y < 0 ? 1 : map.get(x, y, z) !== 0 ? 1 : 0);
    for (let y = cy * CHUNK; y < Math.min(map.sy, (cy + 1) * CHUNK); y++)
      for (let z = cz * CHUNK; z < Math.min(map.sz, (cz + 1) * CHUNK); z++)
        for (let x = cx * CHUNK; x < Math.min(map.sx, (cx + 1) * CHUNK); x++) {
          const m = map.get(x, y, z);
          if (m === 0) continue;
          if (this.masks.size && this.masks.has(blockKey(x, y, z))) continue; // рисуется мешем сколов
          const jitter = jitterOf(x, y, z);
          for (const f of FACES) {
            const nx = x + f.n[0],
              ny = y + f.n[1],
              nz = z + f.n[2];
            if (ny < 0) continue;
            if (map.get(nx, ny, nz) !== 0) continue;
            if (nx < 0 || nz < 0 || nx >= map.sx || nz >= map.sz) continue;
            const base = b.pos.length / 3;
            const ao: number[] = [];
            const tAxis = [0, 1, 2].filter((a) => f.n[a] === 0);
            for (const c of f.c) {
              // AO: два соседа по сторонам и один по диагонали в слое перед гранью
              const s = [0, 0, 0];
              for (const a of tAxis) s[a] = c[a] === 1 ? 1 : -1;
              const a0 = tAxis[0],
                a1 = tAxis[1];
              const o1 = [nx, ny, nz];
              o1[a0] += s[a0];
              const o2 = [nx, ny, nz];
              o2[a1] += s[a1];
              const o3 = [nx, ny, nz];
              o3[a0] += s[a0];
              o3[a1] += s[a1];
              const s1 = solid(o1[0], o1[1], o1[2]),
                s2 = solid(o2[0], o2[1], o2[2]),
                s3 = solid(o3[0], o3[1], o3[2]);
              const occ = s1 && s2 ? 3 : s1 + s2 + s3;
              ao.push(occ);
              b.pos.push((x + c[0]) * VOXEL, (y + c[1]) * VOXEL, (z + c[2]) * VOXEL);
              b.nor.push(f.n[0], f.n[1], f.n[2]);
              const k = (1 - occ * 0.17) * f.shade * jitter;
              // тени чуть холоднее, чтобы солнце читалось
              b.col.push(k * (occ ? 0.94 : 1), k * (occ ? 0.97 : 1), k);
              b.uv.push(...uvOf(m, f.top, c[f.u], c[f.v]));
            }
            if (ao[0] + ao[2] > ao[1] + ao[3]) b.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
    this.setMesh(this.main, key, b.geometry());
  }

  // ---------- Сколы ----------

  /** Под-воксель (в координатах блока, может выходить за его пределы) — твёрдый? */
  private cellSolid(bx: number, by: number, bz: number, cx: number, cy: number, cz: number): boolean {
    const ox = Math.floor(cx / SUB),
      oy = Math.floor(cy / SUB),
      oz = Math.floor(cz / SUB);
    const x = bx + ox,
      y = by + oy,
      z = bz + oz;
    if (y < 0) return true;
    if (this.map.get(x, y, z) === 0) return false;
    const mask = this.masks.get(blockKey(x, y, z));
    if (!mask) return true;
    return !mask[cx - ox * SUB + SUB * (cy - oy * SUB + SUB * (cz - oz * SUB))];
  }

  private subFace(b: Buf, x: number, y: number, z: number, cx: number, cy: number, cz: number, f: (typeof FACES)[number], m: number, k: number) {
    const base = b.pos.length / 3;
    const cell = [cx, cy, cz];
    for (const c of f.c) {
      b.pos.push(x * VOXEL + (cx + c[0]) * SUB_SIZE, y * VOXEL + (cy + c[1]) * SUB_SIZE, z * VOXEL + (cz + c[2]) * SUB_SIZE);
      b.nor.push(f.n[0], f.n[1], f.n[2]);
      b.col.push(k, k, k * 1.02);
      b.uv.push(...uvOf(m, f.top, (cell[f.u] + c[f.u]) / SUB, (cell[f.v] + c[f.v]) / SUB));
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private rebuildChips(key: number) {
    const b = this.buf;
    b.clear();
    const set = this.blocksInChunk.get(key);
    if (set)
      for (const bk of set) {
        const mask = this.masks.get(bk)!;
        const x = bk % 1024,
          z = Math.floor(bk / 1024) % 1024,
          y = Math.floor(bk / (1024 * 1024));
        const m = this.map.get(x, y, z);
        const wood = m === MAT.CRATE || m === MAT.WOOD || m === MAT.TRUNK;
        const jitter = jitterOf(x, y, z);
        for (let cz = 0; cz < SUB; cz++)
          for (let cy = 0; cy < SUB; cy++)
            for (let cx = 0; cx < SUB; cx++) {
              const removed = mask[cx + SUB * (cy + SUB * cz)] === 1;
              for (const f of FACES) {
                const nx = cx + f.n[0],
                  ny = cy + f.n[1],
                  nz = cz + f.n[2];
                const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < SUB && ny < SUB && nz < SUB;
                if (!removed) {
                  if (this.cellSolid(x, y, z, nx, ny, nz)) continue;
                  // наружная грань — как у целого блока, вскрытая — темнее (на дереве — пробоина)
                  const outer = !inside && this.map.get(x + Math.floor(nx / SUB), y + Math.floor(ny / SUB), z + Math.floor(nz / SUB)) === 0;
                  const k = f.shade * jitter * (outer ? 1 : wood ? 0.5 : 0.72);
                  this.subFace(b, x, y, z, cx, cy, cz, f, m, k);
                } else if (!inside) {
                  // за выбитым под-вокселем — грань соседнего целого блока
                  const ox = x + Math.floor(nx / SUB),
                    oy = y + Math.floor(ny / SUB),
                    oz = z + Math.floor(nz / SUB);
                  const om = this.map.get(ox, oy, oz);
                  if (om === 0 || this.masks.has(blockKey(ox, oy, oz))) continue;
                  const back = FACES.find((g) => g.n[0] === -f.n[0] && g.n[1] === -f.n[1] && g.n[2] === -f.n[2])!;
                  const k = back.shade * jitterOf(ox, oy, oz) * 0.72;
                  this.subFace(b, ox, oy, oz, ((nx % SUB) + SUB) % SUB, ((ny % SUB) + SUB) % SUB, ((nz % SUB) + SUB) % SUB, back, om, k);
                }
              }
            }
      }
    this.setMesh(this.chipMesh, key, b.geometry());
  }

  /** Применить операцию скола (перестройка — в flush). */
  applyChip(op: ChipOp): boolean {
    const bk = blockKey(op.bx, op.by, op.bz);
    let mask = this.masks.get(bk);
    const fresh = !mask;
    if (!mask) mask = new Uint8Array(SUB * SUB * SUB);
    if (applyChip(mask, op) === 0 && !fresh) return false;
    if (fresh) {
      this.masks.set(bk, mask);
      const ck = this.chunkOfBlock(op.bx, op.by, op.bz);
      let set = this.blocksInChunk.get(ck);
      if (!set) this.blocksInChunk.set(ck, (set = new Set()));
      set.add(bk);
      this.dirtyMain.add(ck);
    }
    this.dirtyChip.add(this.chunkOfBlock(op.bx, op.by, op.bz));
    // сколотые соседи в других чанках видят изменения этого блока
    for (const f of FACES) {
      const nx = op.bx + f.n[0],
        ny = op.by + f.n[1],
        nz = op.bz + f.n[2];
      if (this.masks.has(blockKey(nx, ny, nz))) this.dirtyChip.add(this.chunkOfBlock(nx, ny, nz));
    }
    return true;
  }

  /** Перестроить изменённые чанки (раз в кадр). */
  flush() {
    if (!this.dirtyMain.size && !this.dirtyChip.size) return;
    const t0 = performance.now();
    for (const k of this.dirtyMain) this.rebuildMain(k);
    for (const k of this.dirtyChip) this.rebuildChips(k);
    const n = this.dirtyMain.size + this.dirtyChip.size;
    this.dirtyMain.clear();
    this.dirtyChip.clear();
    this.lastRebuildMs = (performance.now() - t0) / Math.max(1, n);
  }

  /** Новый раунд: стены как новые. */
  clearChips() {
    for (const ck of this.blocksInChunk.keys()) {
      this.dirtyMain.add(ck);
      this.setMesh(this.chipMesh, ck, null);
    }
    this.masks.clear();
    this.blocksInChunk.clear();
    this.dirtyChip.clear();
  }

  dispose() {
    for (const m of [...this.main.values(), ...this.chipMesh.values()]) m.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.group.clear();
  }
}

/** Для меню: просто меш карты. */
export function buildMapMeshes(map: VoxelMap): { group: THREE.Group; material: THREE.Material } {
  const r = new MapRenderer(map);
  return { group: r.group, material: r.material };
}
