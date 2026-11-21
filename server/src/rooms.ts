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
import { Room, type MatchResult } from './room';

export type RankedMode = 'mm' | 'wm';
const MAPS = MAP_LIST.map((m) => m.id);
const WM_MAPS = WM_MAP_LIST.map((m) => m.id);
/** не спрашивал очередь дольше — выкидываем (закрыл вкладку) */
const QUEUE_STALE_MS = 15000;

interface QEntry {
  accountId: string;
  login: string;
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
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private queues: Record<RankedMode, Map<string, QEntry>> = { mm: new Map(), wm: new Map() };
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
    });
    room.onStat = (acc, d) => this.accounts.addStats(acc, d);
    room.onMatchOver = (r) => this.applyResult(r);
    this.rooms.set(id, room);
    console.log(`комната ${id} создана (${map}), всего ${this.rooms.size}`);
    return room;
  }

  // ---------- Вход в комнату по WebSocket ----------

  /** Куда отправить подключение: свой рейтинговый матч, своё место в паблике или паблик со свободным местом. */
  route(accountId: string, mode: GameMode): Room | string {
    if (mode !== 'public') {
      const id = this.active.get(accountId);
      const room = id ? this.rooms.get(id) : undefined;
      return room && !room.closed ? room : 'Матч не найден — начните поиск заново';
    }
    const publics = [...this.rooms.values()].filter((r) => r.mode === 'public' && !r.closed);
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

  // ---------- Очередь ----------

  rating(accountId: string, mode: RankedMode): number {
    const acc = this.accounts.get(accountId);
    if (!acc) return mode === 'mm' ? MM_START_ELO : WM_START_MMR;
    const r = this.accounts.ratings(acc);
    return mode === 'mm' ? r.mm.elo : r.wm.mmr;
  }

  enqueue(accountId: string, login: string, mode: RankedMode): QueueState {
    if (this.active.has(accountId)) return this.queueState(accountId);
    this.dequeue(accountId);
    const now = Date.now();
    this.queues[mode].set(accountId, { accountId, login, rating: this.rating(accountId, mode), since: now, lastPoll: now });
    return this.queueState(accountId);
  }

  dequeue(accountId: string) {
    this.queues.mm.delete(accountId);
    this.queues.wm.delete(accountId);
  }

  queueState(accountId: string): QueueState {
    const roomId = this.active.get(accountId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (room && !room.closed) return { state: 'found', mode: room.mode as RankedMode };
    for (const mode of ['mm', 'wm'] as RankedMode[]) {
      const e = this.queues[mode].get(accountId);
      if (!e) continue;
      e.lastPoll = Date.now();
      return { state: 'searching', mode, wait: Math.floor((Date.now() - e.since) / 1000), count: this.queues[mode].size, need: GAME_MODES[mode].teamSize * 2, full: this.full };
    }
    return { state: 'idle' };
  }

  private matchmake() {
    const now = Date.now();
    for (const mode of ['mm', 'wm'] as RankedMode[]) {
      const q = this.queues[mode];
      for (const [id, e] of q) if (now - e.lastPoll > QUEUE_STALE_MS) q.delete(id);
      const need = GAME_MODES[mode].teamSize * 2;
      while (!this.full && !this.draining) {
        const list = [...q.values()].sort((a, b) => a.rating - b.rating);
        let group: QEntry[] | null = null;
        for (let i = 0; i + need <= list.length; i++) {
          const win = list.slice(i, i + need);
          // допуск — по тому, кто в группе ждёт меньше всех
          const wait = Math.min(...win.map((e) => (now - e.since) / 1000));
          const allowed = Math.min(1000, 150 + 25 * wait);
          if (win[need - 1].rating - win[0].rating <= allowed) {
            group = win;
            break;
          }
        }
        // отладка: дополнить ботами, если ждут слишком долго
        if (!group && this.botFillAfter > 0 && list.length && list.some((e) => (now - e.since) / 1000 >= this.botFillAfter)) group = list.slice(0, need);
        if (!group) break;
        for (const e of group) q.delete(e.accountId);
        this.startMatch(mode, group);
      }
    }
  }

  private startMatch(mode: RankedMode, group: QEntry[]) {
    const size = GAME_MODES[mode].teamSize;
    // змейка по рейтингу: 1-й → A, 2-й и 3-й → B, 4-й и 5-й → A…
    const sorted = group.slice().sort((a, b) => b.rating - a.rating);
    const a: QEntry[] = [],
      b: QEntry[] = [];
    sorted.forEach((e, i) => (i % 4 === 0 || i % 4 === 3 ? a : b).push(e));
    const [t, ct] = Math.random() < 0.5 ? [a, b] : [b, a];
    const roster: string[] = [];
    for (let i = 0; i < size; i++) roster.push(t[i]?.accountId ?? '');
    for (let i = 0; i < size; i++) roster.push(ct[i]?.accountId ?? '');
    const room = this.create(mode, roster);
    for (const e of group) this.active.set(e.accountId, room.id);
    console.log(`матч ${room.id}: ${group.map((e) => `${e.login}(${e.rating})`).join(', ')}`);
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
      queue: { mm: this.queues.mm.size, wm: this.queues.wm.size },
      list: rooms.map((r) => r.status()),
    };
  }
}
