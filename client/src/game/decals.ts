// Декали на карте: общий пул плоских квадов (кровь сейчас, граффити позже) и кровь на его основе.

import * as THREE from 'three';
import { newMapHit, raycastMap, type VoxelMap } from '../../../shared/src/index';

/**
 * Пул плоских декалей: один InstancedMesh, у каждого экземпляра свои цвет, ячейка текстуры-атласа,
 * размер и срок жизни. Один вызов отрисовки на всё; без прозрачности (alphaTest) — сортировка не нужна.
 * Старые пятна перезаписываются по кругу, перед концом срока пятно плавно сжимается до нуля.
 */
export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private active: Uint8Array;
  private pos: Float32Array;
  private quat: Float32Array;
  private size: Float32Array;
  private born: Float32Array;
  private life: Float32Array;
  private grow: Float32Array;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private n = new THREE.Vector3();
  private col = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private zAxis = new THREE.Vector3(0, 0, 1);
  private uv: THREE.InstancedBufferAttribute;
  private count = 0;

  /**
   * texture — атлас cols×rows одинаковых ячеек (белый рисунок с альфой, цвет задаётся на экземпляр,
   * для граффити — белый множитель); null — сплошной квадрат.
   */
  constructor(
    private max: number,
    texture: THREE.Texture | null,
    private cols = 1,
    private rows = 1,
    private fadeTime = 4,
  ) {
    this.active = new Uint8Array(max);
    this.pos = new Float32Array(max * 3);
    this.quat = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.born = new Float32Array(max);
    this.life = new Float32Array(max);
    this.grow = new Float32Array(max);
    const mat = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    // ячейка атласа на экземпляр: сдвиг и масштаб UV
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * aUv.zw + aUv.xy;\n#endif');
    };
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aUv', this.uv);
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.col.set(0xffffff));
    }
  }

  /**
   * Пятно в точке (x,y,z) на поверхности с нормалью n. size — сторона, м; grow — за сколько секунд
   * растёт до полного размера (лужа); life — сколько живёт, с; cell — ячейка атласа; now — время, с.
   */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, color: number, now: number, life = 60, grow = 0, cell = 0, rot = Math.random() * Math.PI * 2) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.n.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.zAxis, this.n);
    this.q2.setFromAxisAngle(this.zAxis, rot);
    this.q.multiply(this.q2);
    // чуть над поверхностью, чтобы не мерцало
    const o = 0.012;
    this.pos[i * 3] = x + this.n.x * o;
    this.pos[i * 3 + 1] = y + this.n.y * o;
    this.pos[i * 3 + 2] = z + this.n.z * o;
    this.quat[i * 4] = this.q.x;
    this.quat[i * 4 + 1] = this.q.y;
    this.quat[i * 4 + 2] = this.q.z;
    this.quat[i * 4 + 3] = this.q.w;
    this.size[i] = size;
    this.born[i] = now;
    this.life[i] = life;
    this.grow[i] = grow;
    if (!this.active[i]) this.count++;
    this.active[i] = 1;
    this.mesh.setColorAt(i, this.col.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const cx = cell % this.cols,
      cy = Math.floor(cell / this.cols) % this.rows;
    this.uv.setXYZW(i, cx / this.cols, 1 - (cy + 1) / this.rows, 1 / this.cols, 1 / this.rows);
    this.uv.needsUpdate = true;
    this.place(i, grow > 0 ? 0.05 : 1);
  }

  private place(i: number, k: number) {
    const sc = this.size[i] * k;
    this.q.set(this.quat[i * 4], this.quat[i * 4 + 1], this.quat[i * 4 + 2], this.quat[i * 4 + 3]);
    this.m4.compose(this.v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), this.q, this.s.set(sc, sc, 1));
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Раз в кадр: растущие лужи увеличиваются, отжившие пятна сжимаются и освобождают место. */
  update(now: number) {
    if (this.count === 0) return;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      const age = now - this.born[i];
      const left = this.life[i] - age;
      if (left <= 0) {
        this.active[i] = 0;
        this.count--;
        this.mesh.setMatrixAt(i, this.zero);
        this.mesh.instanceMatrix.needsUpdate = true;
      } else if (left < this.fadeTime) this.place(i, left / this.fadeTime);
      else if (age < this.grow[i]) this.place(i, 0.05 + 0.95 * Math.sqrt(age / this.grow[i]));
      else if (this.grow[i] > 0 && age < this.grow[i] + 0.1) this.place(i, 1);
    }
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.zero);
    this.active.fill(0);
    this.count = 0;
    this.next = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const BLOOD_COLORS = [0x8a0e0e, 0x6e0a0a, 0xa51414, 0x5c0808];
const CONFETTI_COLORS = [0xff4d6d, 0xffd23f, 0x3fd0ff, 0x6bff6b, 0xc86bff, 0xff8a3d];

/** Сторона ячейки атласа в пикселях: мало пикселей — крупные «воксельные» квадраты. */
const SPLAT_PX = 12;

/**
 * Атлас из 4 пиксельных клякс (2×2), в стиле вокселей: ядро из квадратных пикселей с рваным краем,
 * потёки-лучи и отдельные капли. Пиксели разной яркости (множитель к цвету экземпляра),
 * фильтр nearest — без сглаживания, края остаются ступенчатыми.
 */
function splatAtlas(): THREE.Texture {
  const S = SPLAT_PX;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const ctx = c.getContext('2d')!;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const SHADES = ['#ffffff', '#e0e0e0', '#c2c2c2'];
  for (let cell = 0; cell < 4; cell++) {
    const bx = (cell % 2) * S,
      by = Math.floor(cell / 2) * S;
    const filled = new Uint8Array(S * S);
    const half = (S - 1) / 2;
    // ядро: «круг» с шумом по краю, у каждой кляксы свой размер
    const core = S * (0.2 + cell * 0.03);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) if (Math.hypot(x - half, y - half) < core + (rnd() - 0.5) * 2.2) filled[y * S + x] = 1;
    // потёки: пиксельные лучи от ядра и капля на конце
    const rays = 3 + cell;
    for (let k = 0; k < rays; k++) {
      const a = rnd() * 6.283;
      const len = core + 1 + rnd() * (S * 0.5 - core - 1);
      for (let t = core * 0.5; t <= len; t += 0.5) {
        const x = Math.round(half + Math.cos(a) * t),
          y = Math.round(half + Math.sin(a) * t);
        if (x >= 0 && y >= 0 && x < S && y < S) filled[y * S + x] = 1;
      }
      const dx = Math.round(half + Math.cos(a) * (len + 1.5)),
        dy = Math.round(half + Math.sin(a) * (len + 1.5));
      if (dx >= 0 && dy >= 0 && dx < S && dy < S) filled[dy * S + dx] = 1;
    }
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (!filled[y * S + x]) continue;
        ctx.fillStyle = SHADES[Math.floor(rnd() * SHADES.length)];
        ctx.fillRect(bx + x, by + y, 1, 1);
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Поворот пятна кратно 90°: пиксели остаются параллельны граням вокселей. */
function gridRot(): number {
  return Math.floor(Math.random() * 4) * (Math.PI / 2);
}

/**
 * Кровь на карте: брызги на стене за раненым (или на полу), лужа под убитым. Только клиент.
 * В режиме confetti пятна разноцветные. Лимит пятен (по умолчанию 256) держит нагрузку.
 */
export class BloodDecals {
  readonly mesh: THREE.InstancedMesh;
  private pool: DecalPool;
  private hit = newMapHit();

  constructor(
    private map: () => VoxelMap,
    max = 256,
  ) {
    this.pool = new DecalPool(max, splatAtlas(), 2, 2, 4);
    this.mesh = this.pool.mesh;
  }

  private color(confetti: boolean): number {
    const set = confetti ? CONFETTI_COLORS : BLOOD_COLORS;
    return set[Math.floor(Math.random() * set.length)];
  }

  /**
   * Попадание: из точки тела (x,y,z) вдоль пули (dx,dy,dz; нули — направление неизвестно) ищем стену
   * в 1,5–3 м — брызги на ней; нет стены — пятно на полу под раненым.
   */
  wound(x: number, y: number, z: number, dx: number, dy: number, dz: number, confetti: boolean, now: number) {
    const known = dx !== 0 || dy !== 0 || dz !== 0;
    const jx = dx + (Math.random() - 0.5) * 0.35,
      jy = dy + (Math.random() - 0.5) * 0.35,
      jz = dz + (Math.random() - 0.5) * 0.35;
    const l = Math.hypot(jx, jy, jz) || 1;
    const reach = 1.5 + Math.random() * 1.5;
    if (known && raycastMap(this.map(), x, y, z, jx / l, jy / l, jz / l, reach, this.hit)) {
      const h = this.hit;
      this.pool.add(x + (jx / l) * h.t, y + (jy / l) * h.t, z + (jz / l) * h.t, h.nx, h.ny, h.nz, 0.35 + Math.random() * 0.45, this.color(confetti), now, 70, 0, Math.floor(Math.random() * 4), gridRot());
      return;
    }
    this.floor(x, y, z, 0.2 + Math.random() * 0.25, confetti, now, 0);
  }

  /** Лужа под телом: растёт около секунды. */
  pooled(x: number, y: number, z: number, confetti: boolean, now: number) {
    this.floor(x, y + 0.3, z, 0.9 + Math.random() * 0.4, confetti, now, 1.1);
  }

  private floor(x: number, y: number, z: number, size: number, confetti: boolean, now: number, grow: number) {
    if (raycastMap(this.map(), x, y, z, 0, -1, 0, 3, this.hit)) {
      const h = this.hit;
      this.pool.add(x, y - h.t, z, h.nx, h.ny, h.nz, size, this.color(confetti), now, grow > 0 ? 90 : 60, grow, Math.floor(Math.random() * 4), gridRot());
    }
  }

  update(now: number) {
    this.pool.update(now);
  }

  clear() {
    this.pool.clear();
  }
}
