// Навигационная сетка для ботов: клетки 0,5 м, где можно стоять,
// с запасом по ширине игрока. Поиск пути A* и выпрямление пути.

import { VOXEL, VoxelMap } from './map';

export class NavGrid {
  readonly w: number;
  readonly h: number;
  /** 1 — проходимо с запасом */
  readonly walk: Uint8Array;
  /** расстояние (в клетках) до ближайшей стены, для выбора укрытий */
  private gScore: Float32Array;
  private came: Int32Array;
  private closed: Uint8Array;
  private stamp: Uint32Array;
  private curStamp = 1;
  private heap: Int32Array;
  private fScore: Float32Array;

  constructor(readonly map: VoxelMap) {
    this.w = map.sx;
    this.h = map.sz;
    const raw = new Uint8Array(this.w * this.h);
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        let ok = map.get(x, 0, z) !== 0;
        for (let y = 1; y <= 4 && ok; y++) if (map.get(x, y, z) !== 0) ok = false;
        raw[x + z * this.w] = ok ? 1 : 0;
      }
    this.walk = new Uint8Array(this.w * this.h);
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        let ok = raw[x + z * this.w] === 1;
        for (let dz = -1; dz <= 1 && ok; dz++)
          for (let dx = -1; dx <= 1 && ok; dx++) {
            const xx = x + dx,
              zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= this.w || zz >= this.h || raw[xx + zz * this.w] === 0) ok = false;
          }
        this.walk[x + z * this.w] = ok ? 1 : 0;
      }
    const n = this.w * this.h;
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.heap = new Int32Array(n * 2);
  }

  cellOf(wx: number, wz: number): number {
    const x = Math.floor(wx / VOXEL),
      z = Math.floor(wz / VOXEL);
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return -1;
    return x + z * this.w;
  }

  isWalk(cell: number): boolean {
    return cell >= 0 && this.walk[cell] === 1;
  }

  /** Ближайшая проходимая клетка (поиск по спирали). */
  nearestWalkable(wx: number, wz: number): number {
    const cx = Math.floor(wx / VOXEL),
      cz = Math.floor(wz / VOXEL);
    for (let r = 0; r < 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx,
            z = cz + dz;
          if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue;
          if (this.walk[x + z * this.w]) return x + z * this.w;
        }
    return -1;
  }

  cellCenter(cell: number): [number, number] {
    return [((cell % this.w) + 0.5) * VOXEL, (Math.floor(cell / this.w) + 0.5) * VOXEL];
  }

  /** Прямая между клетками проходима (проверка по шагам в полклетки). */
  straight(a: number, b: number): boolean {
    const [ax, az] = this.cellCenter(a);
    const [bx, bz] = this.cellCenter(b);
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (VOXEL * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isWalk(this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t))) return false;
    }
    return true;
  }

  /** A* по 8 соседям. Возвращает выпрямленный путь (мировые точки) или null. */
  findPath(sx: number, sz: number, tx: number, tz: number): Array<[number, number]> | null {
    let start = this.cellOf(sx, sz);
    if (!this.isWalk(start)) start = this.nearestWalkable(sx, sz);
    let goal = this.cellOf(tx, tz);
    if (!this.isWalk(goal)) goal = this.nearestWalkable(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.cellCenter(goal)];
    const w = this.w;
    const st = ++this.curStamp;
    const gx = goal % w,
      gz = Math.floor(goal / w);
    const hfn = (c: number) => {
      const dx = Math.abs((c % w) - gx),
        dz = Math.abs(Math.floor(c / w) - gz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const heap = this.heap;
    let hn = 0;
    const push = (c: number) => {
      let i = hn++;
      heap[i] = c;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.fScore[heap[p]] <= this.fScore[heap[i]]) break;
        const t = heap[p];
        heap[p] = heap[i];
        heap[i] = t;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hn];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < hn && this.fScore[heap[l]] < this.fScore[heap[m]]) m = l;
        if (r < hn && this.fScore[heap[r]] < this.fScore[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m];
        heap[m] = heap[i];
        heap[i] = t;
        i = m;
      }
      return top;
    };
    this.stamp[start] = st;
    this.gScore[start] = 0;
    this.closed[start] = 0;
    this.came[start] = -1;
    this.fScore[start] = hfn(start);
    push(start);
    let iter = 0;
    while (hn > 0 && iter++ < 20000) {
      const cur = pop();
      if (cur === goal) break;
      if (this.closed[cur] && this.stamp[cur] === st) continue;
      this.closed[cur] = 1;
      const cx = cur % w,
        cz = Math.floor(cur / w);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx,
            nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
          const nc = nx + nz * w;
          if (!this.walk[nc]) continue;
          if (dx && dz && (!this.walk[cx + dx + cz * w] || !this.walk[cx + (cz + dz) * w])) continue;
          const g = this.gScore[cur] + (dx && dz ? 1.414 : 1);
          if (this.stamp[nc] !== st) {
            this.stamp[nc] = st;
            this.closed[nc] = 0;
            this.gScore[nc] = Infinity;
          }
          if (this.closed[nc]) continue;
          if (g < this.gScore[nc]) {
            this.gScore[nc] = g;
            this.came[nc] = cur;
            this.fScore[nc] = g + hfn(nc);
            if (hn < heap.length) push(nc);
          }
        }
    }
    if (this.stamp[goal] !== st || (this.came[goal] === -1 && goal !== start)) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.came[c]) {
      cells.push(c);
      if (cells.length > 5000) return null;
    }
    cells.reverse();
    // Выпрямление: оставляем только поворотные точки
    const out: Array<[number, number]> = [];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.straight(cells[anchor], cells[i])) {
        anchor = i - 1;
        out.push(this.cellCenter(cells[anchor]));
      }
    }
    out.push(this.cellCenter(goal));
    return out;
  }

  /** Точка с укрытием: проходимая, рядом много непроходимых клеток (стены, ящики). */
  coverIn(x0: number, z0: number, x1: number, z1: number, rnd: () => number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const p = this.randomIn(x0, z0, x1, z1, rnd);
      if (!p) continue;
      const cx = Math.floor(p[0] / VOXEL),
        cz = Math.floor(p[1] / VOXEL);
      let score = 0;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = cx + dx,
            z = cz + dz;
          if (x < 0 || z < 0 || x >= this.w || z >= this.h || !this.walk[x + z * this.w]) score++;
        }
      score += rnd() * 4; // не всегда одна и та же позиция
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** Случайная проходимая точка внутри прямоугольника. */
  randomIn(x0: number, z0: number, x1: number, z1: number, rnd: () => number): [number, number] | null {
    for (let i = 0; i < 60; i++) {
      const x = x0 + (x1 - x0) * rnd(),
        z = z0 + (z1 - z0) * rnd();
      const c = this.cellOf(x, z);
      if (this.isWalk(c)) return this.cellCenter(c);
    }
    return null;
  }
}
