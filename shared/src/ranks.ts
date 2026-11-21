// Рейтинги и звания.
//
// Матчмейкинг 5×5 — как на FACEIT: игрок видит число Elo, а уровень (1–10) просто следует из него.
// Старт 1000 Elo (уровень 4). За матч ±K·(результат − ожидание): при равных командах ≈ ±25,
// за победу над сильными дают больше, за проигрыш слабым снимают больше.
//
// Союзники 2×2 — 12 званий, как в CS. Под капотом скрытый рейтинг (тот же Elo), но звание
// не скачет за каждым матчем:
//   1. Калибровка: первые CALIBRATION матчей звания нет («???»), рейтинг меняется сильнее (K×1,5).
//      После калибровки звание выдаётся сразу по скрытому рейтингу.
//   2. Повышение — только после победы и только на одну ступень за матч, если скрытый
//      рейтинг уже выше порога следующего звания.
//   3. Понижение — только после поражения, на одну ступень, если скрытый рейтинг ниже порога
//      текущего звания. Сразу после повышения 2 матча защиты: звание не падает.

export interface EloLevel {
  level: number;
  min: number;
  color: string;
}

/** Уровни матчмейкинга по Elo (пороги как у FACEIT). */
export const MM_LEVELS: EloLevel[] = [
  { level: 1, min: 0, color: '#c9cdd2' },
  { level: 2, min: 501, color: '#4fd16a' },
  { level: 3, min: 751, color: '#4fd16a' },
  { level: 4, min: 901, color: '#f2d038' },
  { level: 5, min: 1051, color: '#f2d038' },
  { level: 6, min: 1201, color: '#f2d038' },
  { level: 7, min: 1351, color: '#f2d038' },
  { level: 8, min: 1531, color: '#ff8a2a' },
  { level: 9, min: 1751, color: '#ff8a2a' },
  { level: 10, min: 2001, color: '#ff3b3b' },
];
export const MM_START_ELO = 1000;
export const MM_K = 50;

export function mmLevel(elo: number): EloLevel {
  let lv = MM_LEVELS[0];
  for (const l of MM_LEVELS) if (elo >= l.min) lv = l;
  return lv;
}

/** Звания союзников (2×2): название и порог скрытого рейтинга. */
export const WM_RANKS = [
  { name: 'Рядовой', min: 0 },
  { name: 'Ефрейтор', min: 760 },
  { name: 'Младший сержант', min: 850 },
  { name: 'Сержант', min: 925 },
  { name: 'Старший сержант', min: 1000 },
  { name: 'Старшина', min: 1075 },
  { name: 'Прапорщик', min: 1150 },
  { name: 'Лейтенант', min: 1225 },
  { name: 'Капитан', min: 1300 },
  { name: 'Майор', min: 1400 },
  { name: 'Полковник', min: 1525 },
  { name: 'Генерал', min: 1650 },
] as const;
export const WM_START_MMR = 1000;
export const WM_K = 40;
export const WM_CALIBRATION = 5;
export const WM_PROMO_SHIELD = 2;

/** Звание (0–11), которое соответствует скрытому рейтингу. */
export function wmRankFor(mmr: number): number {
  let r = 0;
  WM_RANKS.forEach((x, i) => {
    if (mmr >= x.min) r = i;
  });
  return r;
}

export interface MmRating {
  elo: number;
  matches: number;
  wins: number;
}
export interface WmRating {
  mmr: number;
  /** видимое звание 0–11, null — ещё калибровка */
  rank: number | null;
  matches: number;
  wins: number;
  /** сколько матчей звание защищено от понижения после повышения */
  shield: number;
}
export interface Ratings {
  mm: MmRating;
  wm: WmRating;
}

export function newRatings(): Ratings {
  return { mm: { elo: MM_START_ELO, matches: 0, wins: 0 }, wm: { mmr: WM_START_MMR, rank: null, matches: 0, wins: 0, shield: 0 } };
}

/** Изменение Elo: k·(результат − ожидание по среднему рейтингу команд). Не меньше 1 по модулю. */
export function eloDelta(myTeam: number, oppTeam: number, won: boolean, k: number): number {
  const expected = 1 / (1 + Math.pow(10, (oppTeam - myTeam) / 400));
  const d = Math.round(k * ((won ? 1 : 0) - expected));
  return d === 0 ? (won ? 1 : -1) : d;
}

/** Применить итог матча союзников к рейтингу игрока (меняет объект). Возвращает изменение скрытого рейтинга. */
export function applyWingman(r: WmRating, myTeam: number, oppTeam: number, won: boolean): number {
  const calibrating = r.rank === null;
  const d = eloDelta(myTeam, oppTeam, won, calibrating ? WM_K * 1.5 : WM_K);
  r.mmr = Math.max(0, r.mmr + d);
  r.matches++;
  if (won) r.wins++;
  if (calibrating) {
    if (r.matches >= WM_CALIBRATION) r.rank = wmRankFor(r.mmr);
    return d;
  }
  const target = wmRankFor(r.mmr);
  const rank = r.rank as number;
  if (won && target > rank) {
    r.rank = rank + 1;
    r.shield = WM_PROMO_SHIELD;
  } else if (!won && target < rank && r.shield <= 0) r.rank = rank - 1;
  else if (r.shield > 0) r.shield--;
  return d;
}

/** Подпись звания союзников для интерфейса. */
export function wmRankLabel(r: WmRating | undefined): string {
  if (!r || r.rank === null) return '???';
  return WM_RANKS[r.rank].name;
}
