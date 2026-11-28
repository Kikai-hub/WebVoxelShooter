// Комнаты и поиск рейтинговых матчей.
//
// Комнаты не создаются заранее: паблик появляется, когда первый игрок жмёт «Паблик»
// (и удаляется, когда в нём никого не осталось), рейтинговая — когда поиск собрал матч.
// Всего на сервере не больше MAX_ROOMS комнат всех режимов.
//
// Поиск: игрок встаёт в очередь режима и раз в пару секунд спрашивает её состояние.
// Раз в секунду очередь сортируется по рейтингу и ищется группа нужного размера
// (10 для 5×5, 4 для 2×2) с разбросом не больше допустимого. Допуск растёт со временем
// ожидания: 150 очков сразу, +25 за каждую секунду, до 1000. Команды делятся «змейкой»
// по рейтингу, чтобы средние были близки.

import {
  GAME_MODES,
  MAP_LIST,
  WM_MAP_LIST,
  MAX_ROOMS,
  MM_K,
  MM_START_ELO,
  RECONNECT_HOLD,
  WINGMAN_HALF,
  WINGMAN_ROUND_TIME,
  WM_RANKS,
  WM_START_MMR,
  applyWingman,
  eloDelta,
  mmLevel,
  wmRankLabel,
  type GameMode,
} from '../../shared/src/index';
import type { AccountStore } from './accounts';
import { COUNTDOWN_TIME, Room, WARMUP_TIME, type MatchResult } from './room';

export type RankedMode = 'mm' | 'wm';
const MAPS = MAP_LIST.map((m) => m.id);
const WM_MAPS = WM_MAP_LIST.map((m) => m.id);
/** не спрашивал очередь дольше — выкидываем (закрыл вкладку) */
const QUEUE_STALE_MS = 15000;

/** Группа в очереди: один игрок или всё лобби. Лобби в матче всегда в одной команде. */
interface QGroup {
  id: string;
  members: Array<{ accountId: string; login: string; rating: number }>;
  /** средний рейтинг группы */
  rating: number;
  since: number;
  lastPoll: number;
}

export interface QueueState {
  state: 'idle' | 'searching' | 'found';
  mode?: RankedMode;
  /** сколько уже ищет, секунд */
  wait?: number;
  /** сколько человек в очереди этого режима */
  count?: number;
  need?: number;
  /** все комнаты заняты — матч начнётся, когда освободится */
  full?: boolean;
  /** сколько человек в своей группе (лобби) */
  party?: number;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private queues: Record<RankedMode, Map<string, QGroup>> = { mm: new Map(), wm: new Map() };
  /** аккаунт → id его группы в очереди */
  private inQueue = new Map<string, string>();
  /** аккаунт → id комнаты его текущего рейтингового матча */
  private active = new Map<string, string>();
  private nextId = 1;
  private lastMatchmake = 0;
  draining = false;
  onDrained: (() => void) | null = null;
  /** для отладки: через сколько секунд поиска дополнять матч ботами (0 — никогда) */
  botFillAfter = Number(process.env.RANKED_BOT_FILL ?? 0);

  constructor(
    private accounts: AccountStore,
    private botLevel: string,
    private maxSpectators: number,
  ) {}

  get full(): boolean {
    return this.rooms.size >= MAX_ROOMS;
  }

  private create(mode: GameMode, roster?: string[]): Room {
    const id = `${mode}-${this.nextId++}`;
    const wm = mode === 'wm';
    const pool = wm ? WM_MAPS : MAPS;
    const map = pool[Math.floor(Math.random() * pool.length)];
    const room = new Room(this.botLevel, this.maxSpectators, map, {
      mode,
      id,
      teamSize: GAME_MODES[mode].teamSize,
      half: wm ? WINGMAN_HALF : undefined,
      roundTime: wm ? WINGMAN_ROUND_TIME : undefined,
      roster,
      // разминка перед рейтинговым матчем и отсчёт до начала (с); для тестов — RANKED_WARMUP / RANKED_COUNTDOWN
      warmup: roster ? Math.max(0, Number(process.env.RANKED_WARMUP ?? WARMUP_TIME)) : 0,
      countdown: Math.max(0, Number(process.env.RANKED_COUNTDOWN ?? COUNTDOWN_TIME)),
    });
    room.onStat = (acc, d) => this.accounts.addStats(acc, d);
    room.onMatchOver = (r) => this.applyResult(r);
    // звания в таблице после матча — только в рейтинговых режимах (в паблике их нет)
    // для тестов срок отмены брошенного рейтингового матча можно сократить (RANKED_ABANDON, с)
    if (roster) room.abandonAfter = Math.max(1, Number(process.env.RANKED_ABANDON ?? 90));
    if (roster) room.rankOf = (acc) => this.rankLabel(acc, wm ? 'wm' : 'mm');
    this.rooms.set(id, room);
    console.log(`комната ${id} создана (${map}), всего ${this.rooms.size}`);
    return room;
  }

  // ---------- Вход в комнату по WebSocket ----------

  /** Куда отправить подключение: свой рейтинговый матч, своё место в паблике или паблик со свободным местом. */
  route(accountId: string, mode: GameMode, roomId?: string): Room | string {
    if (mode !== 'public') {
      const id = this.active.get(accountId);
      const room = id ? this.rooms.get(id) : undefined;
      return room && !room.closed ? room : 'Матч не найден — начните поиск заново';
    }
    const publics = [...this.rooms.values()].filter((r) => r.mode === 'public' && !r.closed);
    // комната, которую лидер лобби выбрал для всех
    const chosen = roomId ? this.rooms.get(roomId) : undefined;
    if (chosen && chosen.mode === 'public' && !chosen.closed) return chosen;
    // вернуться на своё место (переподключение)
    const own = publics.find((r) => r.players.some((p) => !p.isBot && (p.accountId === accountId || p.pending?.accountId === accountId)));
    if (own) return own;
    // в самую людную комнату, где есть место у бота
    const withSlot = publics.filter((r) => r.players.some((p) => p.isBot && !p.pending)).sort((a, b) => b.people - a.people);
    if (withSlot.length) return withSlot[0];
    if (this.draining) return 'Сервер обновляется, зайдите через минуту';
    if (!this.full) return this.create('public');
    // мест у ботов нет и комнату не создать — наблюдателем, где есть место
    const watch = publics.find((r) => r.hasRoom());
    return watch ?? `Сервер заполнен: ${MAX_ROOMS} комнат заняты, попробуйте позже`;
  }

  /** Паблик для лобби из size человек: где у ботов хватает мест на всех, иначе — новая комната. */
  publicFor(size: number): Room | string {
    const publics = [...this.rooms.values()].filter((r) => r.mode === 'public' && !r.closed);
    const fits = publics.filter((r) => r.players.filter((p) => p.isBot && !p.pending).length >= size).sort((a, b) => b.people - a.people);
    if (fits.length) return fits[0];
    if (this.draining) return 'Сервер обновляется, зайдите через минуту';
    if (!this.full) return this.create('public');
    return `Нет комнаты на ${size} игроков: все ${MAX_ROOMS} комнат заняты`;
  }

  /** Подпись звания для таблицы игроков: уровень и Elo матчмейкинга или звание союзников. */
  rankLabel(accountId: string, mode: RankedMode): { r: string; c: string } {
    const acc = this.accounts.get(accountId);
    if (!acc) return { r: '???', c: '#9aa0a6' };
    const rt = this.accounts.ratings(acc);
    if (mode === 'wm') return rt.wm.rank === null ? { r: '???', c: '#9aa0a6' } : { r: WM_RANKS[rt.wm.rank].name, c: '#8fb4ff' };
    if (rt.mm.matches === 0) return { r: '??? Elo', c: '#9aa0a6' };
    const lv = mmLevel(rt.mm.elo);
    return { r: `ур. ${lv.level} · ${rt.mm.elo} Elo`, c: lv.color };
  }

  // ---------- Очередь ----------

  rating(accountId: string, mode: RankedMode): number {
    const acc = this.accounts.get(accountId);
    if (!acc) return mode === 'mm' ? MM_START_ELO : WM_START_MMR;
    const r = this.accounts.ratings(acc);
    return mode === 'mm' ? r.mm.elo : r.wm.mmr;
  }

  /** Встать в очередь: members — сам игрок или всё лобби (первым — лидер). */
  enqueue(members: Array<{ accountId: string; login: string }>, mode: RankedMode): QueueState {
    const lead = members[0].accountId;
    if (members.some((m) => this.active.has(m.accountId))) return this.queueState(lead);
    for (const m of members) this.dequeue(m.accountId);
    const now = Date.now();
    const list = members.map((m) => ({ ...m, rating: this.rating(m.accountId, mode) }));
    const g: QGroup = { id: lead, members: list, rating: list.reduce((a, m) => a + m.rating, 0) / list.length, since: now, lastPoll: now };
    this.queues[mode].set(g.id, g);
    for (const m of members) this.inQueue.set(m.accountId, g.id);
    return this.queueState(lead);
  }

  /** Выйти из очереди — вместе со всей своей группой. */
  dequeue(accountId: string) {
    const gid = this.inQueue.get(accountId);
    if (!gid) return;
    for (const q of Object.values(this.queues)) {
      const g = q.get(gid);
      if (!g) continue;
      q.delete(gid);
      for (const m of g.members) this.inQueue.delete(m.accountId);
    }
  }

  private queuedPlayers(mode: RankedMode): number {
    let n = 0;
    for (const g of this.queues[mode].values()) n += g.members.length;
    return n;
  }

  queueState(accountId: string): QueueState {
    const roomId = this.active.get(accountId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (room && !room.closed) return { state: 'found', mode: room.mode as RankedMode };
    const gid = this.inQueue.get(accountId);
    for (const mode of ['mm', 'wm'] as RankedMode[]) {
      const g = gid ? this.queues[mode].get(gid) : undefined;
      if (!g) continue;
      g.lastPoll = Date.now();
      return { state: 'searching', mode, wait: Math.floor((Date.now() - g.since) / 1000), count: this.queuedPlayers(mode), need: GAME_MODES[mode].teamSize * 2, full: this.full, party: g.members.length };
    }
    return { state: 'idle' };
  }

  /**
   * Разделить группы на две команды ровно по size игроков (лобби не разрывается),
   * с самыми близкими средними рейтингами. allowShort — разрешить неполные команды (добор ботами).
   */
  private split(groups: QGroup[], size: number, allowShort = false): [QGroup[], QGroup[]] | null {
    let best: [QGroup[], QGroup[]] | null = null;
    let bestDiff = Infinity;
    const a: QGroup[] = [],
      b: QGroup[] = [];
    const count = (t: QGroup[]) => t.reduce((n, g) => n + g.members.length, 0);
    const avg = (t: QGroup[]) => {
      let sum = 0,
        n = 0;
      for (const g of t)
        for (const m of g.members) {
          sum += m.rating;
          n++;
        }
      return n ? sum / n : 0;
    };
    const dfs = (i: number) => {
      if (i === groups.length) {
        const ca = count(a),
          cb = count(b);
        if (allowShort ? ca > size || cb > size : ca !== size || cb !== size) return;
        const d = Math.abs(avg(a) - avg(b));
        if (d < bestDiff) {
          bestDiff = d;
          best = [a.slice(), b.slice()];
        }
        return;
      }
      for (const t of [a, b]) {
        if (count(t) + groups[i].members.length <= size) {
          t.push(groups[i]);
          dfs(i + 1);
          t.pop();
        }
        if (i === 0) break; // первая группа — всегда в A (симметрия)
      }
    };
    dfs(0);
    return best;
  }

  private matchmake() {
    const now = Date.now();
    for (const mode of ['mm', 'wm'] as RankedMode[]) {
      const q = this.queues[mode];
      for (const [id, g] of q)
        if (now - g.lastPoll > QUEUE_STALE_MS) {
          q.delete(id);
          for (const m of g.members) this.inQueue.delete(m.accountId);
        }
      const size = GAME_MODES[mode].teamSize;
      const need = size * 2;
      while (!this.full && !this.draining) {
        const list = [...q.values()].sort((x, y) => x.rating - y.rating);
        let teams: [QGroup[], QGroup[]] | null = null;
        // окно по рейтингу: группы подряд (не влезающие пропускаем), пока не наберётся ровно need игроков
        for (let i = 0; i < list.length && !teams; i++) {
          const pick: QGroup[] = [];
          let n = 0;
          for (let j = i; j < list.length && n < need; j++) {
            if (n + list[j].members.length > need) continue;
            pick.push(list[j]);
            n += list[j].members.length;
          }
          if (n !== need) continue;
          // допуск по разбросу — по тому, кто из выбранных ждёт меньше всех
          const wait = Math.min(...pick.map((g) => (now - g.since) / 1000));
          const allowed = Math.min(1000, 150 + 25 * wait);
          const all = pick.flatMap((g) => g.members.map((m) => m.rating));
          if (Math.max(...all) - Math.min(...all) > allowed) continue;
          teams = this.split(pick, size);
        }
        // отладка: дополнить ботами, если ждут слишком долго
        if (!teams && this.botFillAfter > 0 && list.some((g) => (now - g.since) / 1000 >= this.botFillAfter)) {
          const pick: QGroup[] = [];
          let n = 0;
          for (const g of list)
            if (n + g.members.length <= need) {
              pick.push(g);
              n += g.members.length;
            }
          teams = this.split(pick, size, true);
        }
        if (!teams) break;
        for (const g of [...teams[0], ...teams[1]]) {
          q.delete(g.id);
          for (const m of g.members) this.inQueue.delete(m.accountId);
        }
        this.startMatch(mode, teams);
      }
    }
  }

  private startMatch(mode: RankedMode, teams: [QGroup[], QGroup[]]) {
    const size = GAME_MODES[mode].teamSize;
    const [t, ct] = Math.random() < 0.5 ? teams : [teams[1], teams[0]];
    const flat = (gs: QGroup[]) => gs.flatMap((g) => g.members);
    const roster: string[] = [];
    for (const side of [flat(t), flat(ct)]) for (let i = 0; i < size; i++) roster.push(side[i]?.accountId ?? '');
    const room = this.create(mode, roster);
    const all = [...flat(t), ...flat(ct)];
    for (const m of all) this.active.set(m.accountId, room.id);
    console.log(`матч ${room.id}: ${all.map((m) => `${m.login}(${m.rating})`).join(', ')}`);
  }

  // ---------- Итог рейтингового матча ----------

  private applyResult(r: MatchResult) {
    const mode = r.room.mode as RankedMode;
    const start = mode === 'mm' ? MM_START_ELO : WM_START_MMR;
    const ratingOf = (acc: string) => (acc ? this.rating(acc, mode) : start);
    // средний рейтинг сторон (по тому, кто был записан в матч; пустые места — стартовый)
    const sum = [0, 0],
      n = [0, 0];
    for (const s of r.slots) {
      sum[s.team] += ratingOf(s.accountId);
      n[s.team]++;
    }
    const avg = [sum[0] / Math.max(1, n[0]), sum[1] / Math.max(1, n[1])];
    for (const s of r.slots) {
      if (!s.accountId) continue;
      const acc = this.accounts.get(s.accountId);
      if (!acc) continue;
      const rt = this.accounts.ratings(acc);
      const my = avg[s.team],
        opp = avg[1 - s.team];
      let msg: { t: 'rating'; mode: GameMode; won: boolean; delta: number; elo: number; rank: string; promo?: string };
      if (mode === 'mm') {
        const d = eloDelta(my, opp, s.won, MM_K);
        rt.mm.elo = Math.max(0, rt.mm.elo + d);
        rt.mm.matches++;
        if (s.won) rt.mm.wins++;
        msg = { t: 'rating', mode, won: s.won, delta: d, elo: rt.mm.elo, rank: `Уровень ${mmLevel(rt.mm.elo).level}` };
      } else {
        const before = rt.wm.rank;
        const d = applyWingman(rt.wm, my, opp, s.won);
        const after = rt.wm.rank;
        let promo: string | undefined;
        if (before === null && after !== null) promo = `Калибровка завершена: ${WM_RANKS[after].name}`;
        else if (before !== null && after !== null && after > before) promo = `Повышение: ${WM_RANKS[after].name}`;
        else if (before !== null && after !== null && after < before) promo = `Понижение: ${WM_RANKS[after].name}`;
        msg = { t: 'rating', mode, won: s.won, delta: d, elo: rt.wm.mmr, rank: wmRankLabel(rt.wm), promo };
      }
      const p = r.room.players.find((q) => !q.isBot && q.accountId === s.accountId);
      p?.conn?.sendJson(msg);
    }
    this.accounts.touch();
  }

  // ---------- Тик ----------

  step() {
    for (const room of this.rooms.values()) room.step();
    const now = Date.now();
    if (now - this.lastMatchmake >= 1000) {
      this.lastMatchmake = now;
      this.matchmake();
    }
    for (const [id, room] of this.rooms) {
      // паблик без единого подключения дольше, чем ждём переподключения, — удаляем
      const abandoned = room.mode === 'public' && room.conns.size === 0 && room.time - room.lastOccupied > RECONNECT_HOLD + 5;
      if (room.closed || abandoned) {
        room.close('Комната закрыта');
        this.rooms.delete(id);
        for (const [acc, rid] of this.active) if (rid === id) this.active.delete(acc);
        console.log(`комната ${id} удалена, осталось ${this.rooms.size}`);
      }
    }
    if (this.draining && this.onDrained) {
      // обновление: ждём, пока закончатся рейтинговые матчи и опустеют паблики
      const busy = [...this.rooms.values()].some((r) => r.conns.size > 0 && (r.ranked || (r.phase !== 'matchEnd' && r.phase !== 'vote')));
      if (!busy) {
        const cb = this.onDrained;
        this.onDrained = null;
        cb();
      }
    }
  }

  get tick(): number {
    let t = 0;
    for (const r of this.rooms.values()) t = Math.max(t, r.tick);
    return t;
  }

  get tickTimeMs(): number {
    let t = 0;
    for (const r of this.rooms.values()) t += r.tickTimeMs;
    return t;
  }

  status() {
    const rooms = [...this.rooms.values()];
    return {
      rooms: rooms.length,
      maxRooms: MAX_ROOMS,
      online: rooms.reduce((n, r) => n + r.conns.size, 0),
      queue: { mm: this.queuedPlayers('mm'), wm: this.queuedPlayers('wm') },
      list: rooms.map((r) => r.status()),
    };
  }
}
