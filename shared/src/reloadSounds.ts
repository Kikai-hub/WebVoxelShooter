// Тайминги звуков перезарядки: доля длительности перезарядки (0..1) и имя щелчка.
// Одна таблица для звука (client/audio.ts) и, позже, для ключевых кадров анимации перезарядки.
// Имя щелчка = имя необязательного файла sounds/reload/<имя>.wav; нет файла — играет синтез.

export const RELOAD_SOUND_NAMES = ['mag_out', 'mag_in', 'bolt', 'pump', 'shell', 'cyl_open', 'cyl_load', 'cyl_close'] as const;
export type ReloadSoundName = (typeof RELOAD_SOUND_NAMES)[number];

export type ReloadStep = readonly [number, ReloadSoundName];

/** Дробовик заряжается по патрону: равномерные щелчки с запасом на финальный досыл. */
function shells(n: number, from: number, to: number): ReloadStep[] {
  const out: ReloadStep[] = [];
  for (let i = 0; i < n; i++) out.push([from + ((to - from) * i) / Math.max(1, n - 1), 'shell']);
  return out;
}

export const RELOAD_TIMINGS: Record<string, readonly ReloadStep[]> = {
  pistol: [[0.15, 'mag_out'], [0.6, 'mag_in'], [0.85, 'bolt']],
  revolver: [[0.1, 'cyl_open'], [0.45, 'cyl_load'], [0.9, 'cyl_close']],
  smg: [[0.15, 'mag_out'], [0.6, 'mag_in'], [0.85, 'bolt']],
  rifle: [[0.15, 'mag_out'], [0.6, 'mag_in'], [0.85, 'bolt']],
  shotgun: [...shells(6, 0.1, 0.72), [0.88, 'pump']],
  sniper: [[0.12, 'bolt'], [0.4, 'mag_out'], [0.7, 'mag_in'], [0.9, 'bolt']],
};

/** Револьверы — по ключам оружия (у них нет своего kind, это пистолеты). */
const REVOLVER_KEYS = new Set(['python', 'sw29']);

export function reloadSteps(kind: string, key = ''): readonly ReloadStep[] {
  if (REVOLVER_KEYS.has(key)) return RELOAD_TIMINGS.revolver;
  return RELOAD_TIMINGS[kind] ?? RELOAD_TIMINGS.rifle;
}
