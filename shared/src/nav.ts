// Навигационная сетка для ботов: клетки 0,5 м в несколько уровней (земля, ступени, крыши).
// В каждом столбце до LEVELS поверхностей, на которых можно стоять. Сосед доступен, если
// перепад не больше одной ступени (0,5 м) — ровно столько поднимает физика (stepUp).
// Поиск пути A* и выпрямление пути. Номер клетки: столбец + уровень × (w·h);
// нижний уровень совпадает с номерами старой плоской сетки.

import { VOXEL, VoxelMap } from './map';

const LEVELS = 4;
/** свободная высота над поверхностью: 4 вокселя = 2 м (игрок 1,8 м) */
const CLEAR = 4;
/** на сколько вокселей может быть ниже соседняя поверхность у края (уступ до 1 м — не обрыв) */
const EDGE_DROP = 2;

export class NavGrid {
  readonly w: number;
  readonly h: number;
  /** клеток в одном уровне */
  readonly n: number;
  /** 1 — проходимо с запасом и достижимо */
  readonly walk: Uint8Array;
  /** высота ног в вокселях для каждой клетки, −1 — поверхности нет */
  readonly fy: Int16Array;
  private gScore: Float32Array;
  private came: Int32Array;
  private closed: Uint8Array;
  private stamp: Uint32Array;
  private curStamp = 1;
  private heap: Int32Array;
  private fScore: Float32Array;

  /**
   * seeds — точки, откуда точно можно ходить (точки появления): клетки, недостижимые
   * от них (крыши высоких домов, верх навесов и ящиков), исключаются из сетки.
   */
  constructor(
    readonly map: VoxelMap,
    seeds?: Array<[number, number]>,
  ) {
    this.w = map.sx;
    this.h = map.sz;
    const n = (this.n = this.w * this.h);
    const total = n * LEVELS;
    this.fy = new Int16Array(total).fill(-1);
    // поверхности: сплошной воксель снизу и CLEAR вокселей воздуха над ним
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        let k = 0;
        for (let y = 1; y + CLEAR <= map.sy && k < LEVELS; y++) {
          if (map.get(x, y - 1, z) === 0) continue;
          let free = true;
          for (let yy = y; yy < y + CLEAR && free; yy++) if (map.get(x, yy, z) !== 0) free = false;
          if (free) {
            this.fy[x + z * this.w + k * n] = y;
            k++;
            y += CLEAR - 1;
          }
        }
      }
    // запас по ширине игрока: все 8 соседей — пол не выше ступени и не обрыв
    const walk = new Uint8Array(total);
    for (let k = 0; k < LEVELS; k++)
      for (let z = 0; z < this.h; z++)
        for (let x = 0; x < this.w; x++) {
          const c = x + z * this.w + k * n;
          const y = this.fy[c];
          if (y < 0) continue;
          let ok = true;
          for (let dz = -1; dz <= 1 && ok; dz++)
            for (let dx = -1; dx <= 1 && ok; dx++) {
              if (!dx && !dz) continue;
              const xx = x + dx,
                zz = z + dz;
              if (xx < 0 || zz < 0 || xx >= this.w || zz >= this.h || this.levelNear(xx + zz * this.w, y, EDGE_DROP, 1) < 0) ok = false;
            }
          walk[c] = ok ? 1 : 0;
        }
    this.walk = walk;
    this.gScore = new Float32Array(total);
    this.fScore = new Float32Array(total);
    this.came = new Int32Array(total);
    this.closed = new Uint8Array(total);
    this.stamp = new Uint32Array(total);
    this.heap = new Int32Array(total * 2);
    if (seeds?.length) this.keepReachable(seeds);
  }

  /** Уровень в столбце col с высотой в [y − down, y + up]; ближайший к y. −1 — нет. */
  private levelNear(col: number, y: number, down: number, up: number): number {
    let best = -1,
      bd = Infinity;
    for (let k = 0; k < LEVELS; k++) {
      const c = col + k * this.n;
      const fy = this.fy[c];
      if (fy < 0) break;
      if (fy < y - down || fy > y + up) continue;
      const d = Math.abs(fy - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Проходимый сосед в столбце col для перехода с высоты y (перепад не больше ступени). */
  private stepTo(col: number, y: number): number {
    for (let k = 0; k < LEVELS; k++) {
      const c = col + k * this.n;
      const fy = this.fy[c];
      if (fy < 0) break;
      if (Math.abs(fy - y) <= 1 && this.walk[c]) return c;
    }
    return -1;
  }

  /** Оставить только клетки, достижимые от seeds (обход в ширину). */
  private keepReachable(seeds: Array<[number, number]>) {
    const reach = new Uint8Array(this.walk.length);
    const queue = new Int32Array(this.walk.length);
    let qh = 0,
      qt = 0;
    for (const [sx, sz] of seeds) {
      // точки появления — на полу (над ними может быть арка или навес)
      const c = this.nearestWalkable(sx, sz, VOXEL);
      if (c >= 0 && !reach[c]) {
        reach[c] = 1;
        queue[qt++] = c;
      }
    }
    const w = this.w;
    while (qh < qt) {
      const cur = queue[qh++];
      const col = cur % this.n;
      const cx = col % w,
        cz = Math.floor(col / w);
      const y = this.fy[cur];
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx,
            nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
          const nc = this.stepTo(nx + nz * w, y);
          if (nc < 0 || reach[nc]) continue;
          reach[nc] = 1;
          queue[qt++] = nc;
        }
    }
    for (let i = 0; i < this.walk.length; i++) if (!reach[i]) this.walk[i] = 0;
  }

  /**
   * Клетка под точкой. wy — высота ног: выбирается поверхность, ближайшая по высоте;
   * без wy — нижняя проходимая (земля).
   */
  cellOf(wx: number, wz: number, wy?: number): number {
    const x = Math.floor(wx / VOXEL),
      z = Math.floor(wz / VOXEL);
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return -1;
    const col = x + z * this.w;
    if (wy === undefined) {
      for (let k = 0; k < LEVELS; k++) {
        const c = col + k * this.n;
        if (this.fy[c] < 0) break;
        if (this.walk[c]) return c;
      }
      return col;
    }
    const y = Math.round(wy / VOXEL);
    let best = col,
      bd = Infinity;
    for (let k = 0; k < LEVELS; k++) {
      const c = col + k * this.n;
      if (this.fy[c] < 0) break;
      const d = Math.abs(this.fy[c] - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  isWalk(cell: number): boolean {
    return cell >= 0 && this.walk[cell] === 1;
  }

  /** Ближайшая проходимая клетка (поиск по спирали); с wy — предпочтительно на той же высоте. */
  nearestWalkable(wx: number, wz: number, wy?: number): number {
    const cx = Math.floor(wx / VOXEL),
      cz = Math.floor(wz / VOXEL);
    const y = wy === undefined ? -1 : Math.round(wy / VOXEL);
    for (let r = 0; r < 12; r++) {
      let best = -1,
        bd = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx,
            z = cz + dz;
          if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue;
          for (let k = 0; k < LEVELS; k++) {
            const c = x + z * this.w + k * this.n;
            if (this.fy[c] < 0) break;
            if (!this.walk[c]) continue;
            const d = y < 0 ? k : Math.abs(this.fy[c] - y);
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
        }
      if (best >= 0 && (y < 0 || bd <= 2 || r >= 6)) return best;
    }
    return -1;
  }

  cellCenter(cell: number): [number, number] {
    const col = cell % this.n;
    return [((col % this.w) + 0.5) * VOXEL, (Math.floor(col / this.w) + 0.5) * VOXEL];
  }

  /** Высота ног в клетке, м. */
  cellY(cell: number): number {
    return this.fy[cell] * VOXEL;
  }

  /** Прямая между клетками проходима: по шагам в полклетки, без скачков высоты больше ступени. */
  straight(a: number, b: number): boolean {
    const [ax, az] = this.cellCenter(a);
    const [bx, bz] = this.cellCenter(b);
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (VOXEL * 0.5));
    let y = this.fy[a];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor((ax + (bx - ax) * t) / VOXEL),
        z = Math.floor((az + (bz - az) * t) / VOXEL);
      if (x < 0 || z < 0 || x >= this.w || z >= this.h) return false;
      const c = this.stepTo(x + z * this.w, y);
      if (c < 0) return false;
      y = this.fy[c];
    }
    return Math.abs(y - this.fy[b]) <= 1;
  }

  /**
   * A* по 8 соседям с учётом уровней. sy, ty — высота ног начала и цели (м);
   * без них — нижний уровень. Возвращает выпрямленный путь (точки x, z) или null.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, sy?: number, ty?: number): Array<[number, number]> | null {
    let start = this.cellOf(sx, sz, sy);
    if (!this.isWalk(start)) start = this.nearestWalkable(sx, sz, sy);
    let goal = this.cellOf(tx, tz, ty);
    if (!this.isWalk(goal)) goal = this.nearestWalkable(tx, tz, ty);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.cellCenter(goal)];
    const w = this.w,
      n = this.n;
    const st = ++this.curStamp;
    const gcol = goal % n;
    const gx = gcol % w,
      gz = Math.floor(gcol / w);
    const hfn = (c: number) => {
      const col = c % n;
      const dx = Math.abs((col % w) - gx),
        dz = Math.abs(Math.floor(col / w) - gz);
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
    while (hn > 0 && iter++ < 30000) {
      const cur = pop();
      if (cur === goal) break;
      if (this.closed[cur] && this.stamp[cur] === st) continue;
      this.closed[cur] = 1;
      const col = cur % n;
      const cx = col % w,
        cz = Math.floor(col / w);
      const y = this.fy[cur];
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx,
            nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
          const nc = this.stepTo(nx + nz * w, y);
          if (nc < 0) continue;
          // по диагонали — только если оба боковых прохода открыты на той же высоте
          if (dx && dz && (this.stepTo(cx + dx + cz * w, y) < 0 || this.stepTo(cx + (cz + dz) * w, y) < 0)) continue;
          const g = this.gScore[cur] + (dx && dz ? 1.414 : 1) + (this.fy[nc] !== y ? 0.5 : 0);
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

  /** Укрытие рядом: сколько соседних столбцов закрыто стеной на высоте корпуса. */
  private coverScore(c: number): number {
    const col = c % this.n;
    const cx = col % this.w,
      cz = Math.floor(col / this.w);
    const y = this.fy[c];
    let score = 0;
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx,
          z = cz + dz;
        if (this.map.get(x, y + 1, z) !== 0 || this.map.get(x, y + 2, z) !== 0) score++;
      }
    return score;
  }

  /** Точка с укрытием: проходимая, рядом стены или ящики на высоте корпуса. */
  coverIn(x0: number, z0: number, x1: number, z1: number, rnd: () => number): [number, number, number] | null {
    let best: [number, number, number] | null = null;
    let bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const c = this.randomCell(x0, z0, x1, z1, rnd, false);
      if (c < 0) continue;
      const score = this.coverScore(c) + rnd() * 4; // не всегда одна и та же позиция
      if (score > bestScore) {
        bestScore = score;
        const [x, z] = this.cellCenter(c);
        best = [x, z, this.cellY(c)];
      }
    }
    return best;
  }

  private randomCell(x0: number, z0: number, x1: number, z1: number, rnd: () => number, high: boolean): number {
    for (let i = 0; i < 60; i++) {
      const x = Math.floor((x0 + (x1 - x0) * rnd()) / VOXEL),
        z = Math.floor((z0 + (z1 - z0) * rnd()) / VOXEL);
      if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue;
      const col = x + z * this.w;
      // сначала нижний уровень (как раньше), второй ярус — только по запросу high
      for (let k = 0; k < LEVELS; k++) {
        const c = col + k * this.n;
        if (this.fy[c] < 0) break;
        if (!this.walk[c]) continue;
        if (high ? this.fy[c] >= HIGH : this.fy[c] < HIGH) return c;
      }
    }
    return -1;
  }

  /** Случайная проходимая точка внутри прямоугольника на нижнем уровне: [x, z, высота ног]. */
  randomIn(x0: number, z0: number, x1: number, z1: number, rnd: () => number): [number, number, number] | null {
    const c = this.randomCell(x0, z0, x1, z1, rnd, false);
    if (c < 0) return null;
    const [x, z] = this.cellCenter(c);
    return [x, z, this.cellY(c)];
  }

  /** Случайная точка второго яруса (крыша, площадка) внутри прямоугольника или null. */
  highIn(x0: number, z0: number, x1: number, z1: number, rnd: () => number): [number, number, number] | null {
    const c = this.randomCell(x0, z0, x1, z1, rnd, true);
    if (c < 0) return null;
    const [x, z] = this.cellCenter(c);
    return [x, z, this.cellY(c)];
  }

  /** Сколько проходимых клеток второго яруса на карте. */
  highCount(): number {
    let k = 0;
    for (let i = 0; i < this.walk.length; i++) if (this.walk[i] && this.fy[i] >= HIGH) k++;
    return k;
  }
}

/** Второй ярус: ноги выше 2 м над полом (пол — 1 воксель, ступень на ящик в 1 м не считается). */
const HIGH = 1 + 4;
