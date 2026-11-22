// Свой прицел игрока: хранится в настройках аккаунта (сервер только проверяет значения),
// рисуется только у самого игрока — другим не передаётся.

export const CROSSHAIR_STYLES = ['cross', 'cross-dot', 't', 'dot', 'circle'] as const;
export type CrosshairStyle = (typeof CROSSHAIR_STYLES)[number];
export const CROSSHAIR_STYLE_NAMES: Record<CrosshairStyle, string> = {
  cross: 'Крест',
  'cross-dot': 'Крест с точкой',
  t: 'Буква «Т»',
  dot: 'Точка',
  circle: 'Круг с точкой',
};

export interface Crosshair {
  style: CrosshairStyle;
  /** цвет #rrggbb */
  color: string;
  /** длина штриха, px */
  size: number;
  /** толщина, px */
  thickness: number;
  /** зазор от центра, px */
  gap: number;
  /** чёрная обводка */
  outline: boolean;
  /** непрозрачность 0.2–1 */
  alpha: number;
  /** расходится при стрельбе и беге (как разброс) */
  dynamic: boolean;
}

export const DEFAULT_CROSSHAIR: Crosshair = { style: 'cross', color: '#7dff7d', size: 8, thickness: 2, gap: 4, outline: true, alpha: 1, dynamic: true };

export function sanitizeCrosshair(c: unknown): Crosshair {
  const o = (c && typeof c === 'object' ? c : {}) as Partial<Crosshair>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : d);
  return {
    style: CROSSHAIR_STYLES.includes(o.style as CrosshairStyle) ? (o.style as CrosshairStyle) : DEFAULT_CROSSHAIR.style,
    color: typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color.toLowerCase() : DEFAULT_CROSSHAIR.color,
    size: num(o.size, 1, 24, DEFAULT_CROSSHAIR.size),
    thickness: num(o.thickness, 1, 8, DEFAULT_CROSSHAIR.thickness),
    gap: num(o.gap, 0, 20, DEFAULT_CROSSHAIR.gap),
    outline: typeof o.outline === 'boolean' ? o.outline : DEFAULT_CROSSHAIR.outline,
    alpha: num(o.alpha, 0.2, 1, DEFAULT_CROSSHAIR.alpha),
    dynamic: typeof o.dynamic === 'boolean' ? o.dynamic : DEFAULT_CROSSHAIR.dynamic,
  };
}

/** Нарисовать прицел в центре 2D-канваса; spreadPx — добавка к зазору (динамический прицел). */
export function drawCrosshair(g: CanvasRenderingContext2D, w: number, h: number, c: Crosshair, spreadPx = 0) {
  g.clearRect(0, 0, w, h);
  const cx = Math.round(w / 2),
    cy = Math.round(h / 2);
  const t = c.thickness;
  const gap = c.gap + (c.dynamic ? spreadPx : 0);
  const rects: Array<[number, number, number, number]> = [];
  const lines = c.style === 'cross' || c.style === 'cross-dot' || c.style === 't';
  if (lines) {
    const off = Math.floor(t / 2);
    rects.push([cx - gap - c.size, cy - off, c.size, t]); // влево
    rects.push([cx + gap, cy - off, c.size, t]); // вправо
    if (c.style !== 't') rects.push([cx - off, cy - gap - c.size, t, c.size]); // вверх
    rects.push([cx - off, cy + gap, t, c.size]); // вниз
  }
  if (c.style === 'cross-dot' || c.style === 'dot' || c.style === 'circle') {
    const d = Math.max(2, Math.round(t * (c.style === 'dot' ? 1.5 : 1)));
    rects.push([cx - Math.floor(d / 2), cy - Math.floor(d / 2), d, d]);
  }
  g.globalAlpha = c.alpha;
  if (c.outline) {
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, rw, rh] of rects) g.fillRect(x - 1, y - 1, rw + 2, rh + 2);
  }
  if (c.style === 'circle') {
    const r = gap + c.size / 2 + 2;
    if (c.outline) {
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineWidth = t + 2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = c.color;
    g.lineWidth = t;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = c.color;
  for (const [x, y, rw, rh] of rects) g.fillRect(x, y, rw, rh);
  g.globalAlpha = 1;
}
