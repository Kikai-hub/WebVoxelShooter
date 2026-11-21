// Меш карты: один меш на чанк 16³, только видимые грани, запечённое
// затенение в углах (AO) в цвете вершин, пиксельный атлас.

import * as THREE from 'three';
import { MAT, VOXEL, VoxelMap } from '../../../shared/src/index';
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

function transparent(m: number): boolean {
  return m === 0;
}

export function buildMapMeshes(map: VoxelMap): { group: THREE.Group; material: THREE.Material } {
  const atlas = buildAtlas();
  const material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
  const group = new THREE.Group();
  const solid = (x: number, y: number, z: number) => (y < 0 ? 1 : map.get(x, y, z) !== 0 ? 1 : 0);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const du = 1 / ATLAS_COLS;
  const pad = 0.5 / (ATLAS_COLS * TILE);

  for (let cy = 0; cy < Math.ceil(map.sy / CHUNK); cy++)
    for (let cz = 0; cz < Math.ceil(map.sz / CHUNK); cz++)
      for (let cx = 0; cx < Math.ceil(map.sx / CHUNK); cx++) {
        pos.length = nor.length = uv.length = col.length = idx.length = 0;
        for (let y = cy * CHUNK; y < Math.min(map.sy, (cy + 1) * CHUNK); y++)
          for (let z = cz * CHUNK; z < Math.min(map.sz, (cz + 1) * CHUNK); z++)
            for (let x = cx * CHUNK; x < Math.min(map.sx, (cx + 1) * CHUNK); x++) {
              const m = map.get(x, y, z);
              if (m === 0) continue;
              // лёгкая неровность цвета блока
              const jitter = 0.93 + ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 100) / 1000;
              for (const f of FACES) {
                const nx = x + f.n[0],
                  ny = y + f.n[1],
                  nz = z + f.n[2];
                if (ny < 0) continue;
                const nm = map.get(nx, ny, nz);
                if (!transparent(nm)) continue;
                if (nx < 0 || nz < 0 || nx >= map.sx || nz >= map.sz) continue;
                const base = pos.length / 3;
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
                  pos.push((x + c[0]) * VOXEL, (y + c[1]) * VOXEL, (z + c[2]) * VOXEL);
                  nor.push(f.n[0], f.n[1], f.n[2]);
                  const k = (1 - occ * 0.17) * f.shade * jitter;
                  // тени чуть холоднее, чтобы солнце читалось
                  col.push(k * (occ ? 0.94 : 1), k * (occ ? 0.97 : 1), k);
                  const row = f.top && m !== MAT.LEAVES ? 1 : 0;
                  const uu = c[f.u],
                    vv = c[f.v];
                  uv.push(m * du + (uu ? du - pad : pad), 1 - (row * 0.5 + (vv ? pad : 0.5 - pad)));
                }
                if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
                else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
              }
            }
        if (!idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
  return { group, material };
}
