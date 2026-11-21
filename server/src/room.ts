// Единственная игровая комната: 10 слотов (5×5), боты на пустых местах,
// режим «Бомба», авторитарная симуляция 64 Гц, снапшоты 30 Гц.

import {
  ARMOR_PRICE,
  BOMB_TIMER,
  BTN_FIRE,
  BTN_DROP,
  FLASH_RANGE,
  HE_MAX_DAMAGE,
  HE_RADIUS,
  MAX_DROPS,
  NADE_FUSE,
  NADE_LIMIT,
  NADE_TYPES,
  SLOT_HE,
  SMOKE_TIME,
  PART_LEG_L,
  VOXEL,
  smokeBlocks,
  MAX_CHIPS_PER_BLOCK,
  MAX_CHIPS_PER_ROUND,
  blockKey,
  chipToArray,
  chippable,
  makeChip,
  stepNade,
  throwNade,
  type NadeState,
  type Smoke,
  BTN_RELOAD,
  BTN_USE,
  BUY_TIME,
  DEFUSE_RANGE,
  DEFUSE_TIME,
  DEFUSE_TIME_KIT,
  KIT_PRICE,
  DEFAULT_PISTOL,
  DT,
  FREEZE_TIME,
  HALF_ROUNDS,
  HEAD_EXPLODE_CHANCE,
  HELMET_PRICE,
  HISTORY_TICKS,
  KNIFE,
  LOSS_BONUS_STEP,
  LOSS_REWARD,
  LOSS_REWARD_MAX,
  MAPS,
  MATCH_END_TIME,
  MAX_LAG_COMP_TICKS,
  MAX_MONEY,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  VOTE_TIME,
  MAX_WOUNDS,
  PART_DAMAGE,
  PART_HEAD,
  PART_TORSO,
  PLANT_REWARD,
  PLANT_TIME,
  POSE_SIZE,
  RECONNECT_HOLD,
  ROUND_END_TIME,
  ROUND_TIME,
  RUN_SPEED,
  SF_ALIVE,
  SF_CROUCH,
  SF_ONGROUND,
  SF_RELOADING,
  SF_USING,
  SLOT_KNIFE,
  SLOT_PISTOL,
  SLOT_PRIMARY,
  SNAPSHOT_RATE,
  START_MONEY,
  TEAM_CT,
  TEAM_SIZE,
  TEAM_T,
  TICK_RATE,
  WEAPONS,
  WEAPON_BY_KEY,
  WIN_REWARD,
  WIN_ROUNDS,
  Rng,
  NavGrid,
  computePose,
  copyPState,
  encodeSnapshot,
  eyeHeight,
  inRect,
  lineOfSight,
  newBodyHit,
  newMapHit,
  newOwnState,
  newPState,
  rand01,
  raycastBody,
  raycastMap,
  shotDirection,
  snapshotSize,
  stepPlayer,
  type BombStatus,
  type EntState,
  type FullState,
  type GameEvent,
  type MapInfo,
  type PState,
  type Phase,
  type PublicPlayer,
  type RoomState,
  type ServerMsg,
  type Team,
  type UserCmd,
  type WeaponDef,
} from '../../shared/src/index';
import { Bot, BOT_NAMES } from './bot';

export interface Loadout {
  primary: [string, string];
  pistol: [string, string];
  agent: [number, number];
  skin: number;
}

export const DEFAULT_LOADOUT: Loadout = { primary: ['vikhr', 'vikhr'], pistol: ['osa', 'osa'], agent: [0, 0], skin: 0 };

export interface Conn {
  id: number;
  accountId: string;
  login: string;
  loadout: Loadout;
  slot: number; // -1 — наблюдатель
  pendingSlot: number;
  lastChat: number;
  sendJson(msg: ServerMsg): void;
  sendBin(buf: ArrayBuffer): void;
  buffered(): number;
  close(reason: string): void;
}

export interface WeaponInst {
  def: WeaponDef;
  mag: number;
  reserve: number;
}

function inst(def: WeaponDef): WeaponInst {
  return { def, mag: def.mag, reserve: def.reserve };
}

export class Player {
  team: Team;
  name = '';
  isBot = true;
  accountId: string | null = null;
  conn: Conn | null = null;
  disconnectedAt = 0;
  pending: Conn | null = null;
  bot: Bot | null = null;
  st: PState = newPState();
  yaw = 0;
  pitch = 0;
  alive = false;
  hp = 0;
  armor = 0;
  helmet = false;
  money = START_MONEY;
  primary: WeaponInst | null = null;
  pistol: WeaponInst = inst(DEFAULT_PISTOL);
  slot = SLOT_PISTOL;
  simTime = 0;
  nextFire = 0;
  reloadEnd = 0;
  recoil = 0;
  lastButtons = 0;
  lastSeq = 0;
  cmdQueue: UserCmd[] = [];
  useProgress = 0;
  hasBomb = false;
  wounds: number[] = [];
  kills = 0;
  deaths = 0;
  agent = 0;
  skin = 0;
  loadout: Loadout = DEFAULT_LOADOUT;
  deathYaw = 0;
  exploded = false;
  lastHurtFrom: [number, number, number] | null = null;
  lastHurtAt = -10;
  diedAt = -10;
  /** до какого времени видим каждому из игроков (для отсечения невидимых) */
  visUntil = new Float32Array(MAX_PLAYERS);

  constructor(
    readonly id: number,
    team: Team,
  ) {
    this.team = team;
  }

  /** гранаты: осколочные, светошумовые, дымовые */
  nades: [number, number, number] = [0, 0, 0];
  blindUntil = 0;
  /** набор сапёра: обезвреживание за 5 с вместо 10 */
  hasKit = false;

  get weapon(): WeaponDef {
    if (this.slot === SLOT_PRIMARY && this.primary) return this.primary.def;
    if (this.slot === SLOT_PISTOL) return this.pistol.def;
    if (this.slot >= SLOT_HE && this.slot <= SLOT_HE + 2) return WEAPONS[7 + this.slot - SLOT_HE];
    return KNIFE;
  }
  get gunSlot(): number {
    return this.primary ? SLOT_PRIMARY : SLOT_PISTOL;
  }
  get weaponInst(): WeaponInst | null {
    if (this.slot === SLOT_PRIMARY) return this.primary;
    if (this.slot === SLOT_PISTOL) return this.pistol;
    return null;
  }
  eye(): [number, number, number] {
    return [this.st.x, this.st.y + eyeHeight(this.st), this.st.z];
  }
}

interface Bomb {
  status: BombStatus;
  carrier: number;
  x: number;
  y: number;
  z: number;
  site: number;
  explodeAt: number;
  defuser: number;
}

const HIST_STRIDE = 7;

export class Room {
  info!: MapInfo;
  nav!: NavGrid;
  mapId = 'market';
  players: Player[] = [];
  spectators = new Set<Conn>();
  conns = new Set<Conn>();
  tick = 0;
  phase: Phase = 'freeze';
  phaseEnd = 0;
  liveStart = 0;
  roundNum = 0;
  scores: [number, number] = [0, 0];
  lossStreak: [number, number] = [0, 0];
  halfDone = false;
  bomb: Bomb = { status: 'none', carrier: -1, x: 0, y: 0, z: 0, site: -1, explodeAt: 0, defuser: -1 };
  rng = new Rng(Date.now() & 0xffffffff);
  tPlan = 0;
  events: GameEvent[] = [];
  /** история позиций для компенсации задержки */
  private hist = new Float32Array(HISTORY_TICKS * MAX_PLAYERS * HIST_STRIDE);
  private histTick = new Int32Array(HISTORY_TICKS).fill(-1);
  private pose = new Float32Array(POSE_SIZE);
  private bodyHit = newBodyHit();
  private mapHit = newMapHit();
  private dir: [number, number, number] = [0, 0, 0];
  /** летящие гранаты */
  nadesInFlight: Array<{ id: number; owner: number; team: Team; type: number; st: NadeState; thrownAt: number }> = [];
  smokes: Smoke[] = [];
  /** оружие на земле */
  drops: Array<{ id: number; inst: WeaponInst; x: number; y: number; z: number; r: number }> = [];
  private nextNadeId = 1;
  private nextDropId = 1;
  private lastStateSent = 0;
  draining = false;
  onDrained: (() => void) | null = null;
  /** статистика для теста ботов */
  stats = { roundsWon: [0, 0] as [number, number], matches: 0, matchWins: [0, 0] as [number, number], stuck: 0, reasons: {} as Record<string, number>, kills: 0, headshots: 0, explodes: 0, shots: 0, hits: 0, reactSum: 0, reactN: 0, mapsPlayed: {} as Record<string, number>, nades: [0, 0, 0] as [number, number, number], nadeKills: 0, blinded: 0 };
  tickTimeMs = 0;

  constructor(
    readonly botLevel: string = 'medium',
    readonly maxSpectators: number = MAX_SPECTATORS,
    initialMap = 'market',
  ) {
    this.loadMap(MAPS[initialMap] ? initialMap : 'market');
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = new Player(i, i < TEAM_SIZE ? TEAM_T : TEAM_CT);
      this.makeBot(p);
      this.players.push(p);
    }
    this.startMatch();
  }

  get time(): number {
    return this.tick * DT;
  }

  loadMap(id: string) {
    this.mapId = id;
    this.info = MAPS[id]();
    this.nav = new NavGrid(this.info.map);
  }

  private makeBot(p: Player) {
    p.isBot = true;
    p.accountId = null;
    p.conn = null;
    p.pending = null;
    const used = new Set(this.players.filter((q) => q !== p && q.isBot).map((q) => q.name));
    const free = BOT_NAMES.filter((n) => !used.has('BOT ' + n));
    p.name = 'BOT ' + (free.length ? free[this.rng.int(free.length)] : String(p.id));
    p.bot = new Bot(this, p, this.botLevel);
    p.agent = this.rng.int(2);
    p.skin = 0;
    p.loadout = DEFAULT_LOADOUT;
  }

  // ---------- Подключения ----------

  humanCount(team?: number): number {
    return this.players.filter((p) => (!p.isBot || p.pending) && (team === undefined || p.team === team)).length;
  }

  join(conn: Conn): void {
    this.conns.add(conn);
    // Переподключение к своему месту
    const own = this.players.find((p) => !p.isBot && p.accountId === conn.accountId);
    if (own) {
      if (own.conn && own.conn !== conn) {
        own.conn.close('Вход с другого устройства');
      }
      own.conn = conn;
      // новое подключение нумерует команды заново
      own.lastSeq = 0;
      own.cmdQueue.length = 0;
      own.lastButtons = 0;
      conn.slot = own.id;
      this.sendFull(conn);
      this.events.push({ e: 'info', text: `${conn.login} вернулся в игру` });
      return;
    }
    const pend = this.players.find((p) => p.pending && p.pending.accountId === conn.accountId);
    if (pend) {
      pend.pending!.close('Вход с другого устройства');
      pend.pending = conn;
      conn.pendingSlot = pend.id;
      conn.slot = -1;
      this.spectators.add(conn);
      this.sendFull(conn);
      return;
    }
    const slot = this.findBotSlot();
    if (slot) {
      this.assignHuman(slot, conn);
      return;
    }
    if (this.spectators.size >= this.maxSpectators) {
      conn.sendJson({ t: 'kick', msg: 'Комната заполнена: 10 игроков и 20 наблюдателей' });
      conn.close('full');
      this.conns.delete(conn);
      return;
    }
    conn.slot = -1;
    conn.pendingSlot = -1;
    this.spectators.add(conn);
    this.sendFull(conn);
    this.events.push({ e: 'info', text: `${conn.login} наблюдает (в очереди)` });
  }

  private findBotSlot(): Player | null {
    const ht = this.humanCount(TEAM_T),
      hc = this.humanCount(TEAM_CT);
    const order: Team[] = ht <= hc ? [TEAM_T, TEAM_CT] : [TEAM_CT, TEAM_T];
    for (const team of order) {
      const bots = this.players.filter((p) => p.team === team && p.isBot && !p.pending);
      if (bots.length) {
        // сначала мёртвые боты — их можно заменить сразу
        bots.sort((a, b) => Number(a.alive) - Number(b.alive));
        return bots[0];
      }
    }
    return null;
  }

  private assignHuman(p: Player, conn: Conn) {
    const immediate = !p.alive || this.phase === 'freeze' || this.phase === 'roundEnd' || this.phase === 'matchEnd';
    if (immediate) {
      this.replaceBot(p, conn);
    } else {
      p.pending = conn;
      conn.pendingSlot = p.id;
      conn.slot = -1;
      this.spectators.add(conn);
      this.sendFull(conn);
      this.events.push({ e: 'info', text: `${conn.login} войдёт вместо ${p.name} в следующем раунде` });
    }
  }

  private replaceBot(p: Player, conn: Conn) {
    this.spectators.delete(conn);
    const wasAlive = p.alive;
    p.isBot = false;
    p.bot = null;
    p.pending = null;
    p.accountId = conn.accountId;
    p.conn = conn;
    p.name = conn.login;
    p.loadout = conn.loadout;
    p.agent = conn.loadout.agent[p.team] ?? 0;
    p.skin = conn.loadout.skin;
    p.money = START_MONEY;
    p.primary = null;
    p.pistol = inst(WEAPON_BY_KEY[conn.loadout.pistol[p.team]] && WEAPON_BY_KEY[conn.loadout.pistol[p.team]].price === 0 ? WEAPON_BY_KEY[conn.loadout.pistol[p.team]] : DEFAULT_PISTOL);
    p.slot = SLOT_PISTOL;
    p.armor = 0;
    p.helmet = false;
    p.hasKit = false;
    p.kills = 0;
    p.deaths = 0;
    p.cmdQueue.length = 0;
    p.lastSeq = 0;
    p.lastButtons = 0;
    // в заморозке игрок сразу встаёт на место бота; если бот мёртв — наблюдает до следующего раунда
    if (wasAlive && this.phase === 'freeze') p.slot = SLOT_PISTOL;
    conn.slot = p.id;
    conn.pendingSlot = -1;
    this.sendFull(conn);
    this.events.push({ e: 'info', text: `${conn.login} вошёл в игру` });
  }

  leave(conn: Conn): void {
    this.conns.delete(conn);
    this.spectators.delete(conn);
    for (const p of this.players) {
      if (p.pending === conn) p.pending = null;
      if (p.conn === conn) {
        p.conn = null;
        p.disconnectedAt = this.time;
        p.cmdQueue.length = 0;
        this.events.push({ e: 'info', text: `${p.name} отключился, место ждёт ${RECONNECT_HOLD} с` });
      }
    }
  }

  private fillFromQueue() {
    for (const c of this.spectators) {
      if (c.pendingSlot >= 0) continue;
      const slot = this.findBotSlot();
      if (!slot) return;
      this.assignHuman(slot, c);
    }
  }

  onCmds(conn: Conn, cmds: UserCmd[]) {
    if (conn.slot < 0) return;
    const p = this.players[conn.slot];
    if (p.conn !== conn) return;
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue;
      if (p.cmdQueue.length && c.seq <= p.cmdQueue[p.cmdQueue.length - 1].seq) continue;
      p.cmdQueue.push(c);
    }
    // защита от «ускорения»: не больше 16 команд в очереди
    if (p.cmdQueue.length > 16) p.cmdQueue.splice(0, p.cmdQueue.length - 16);
  }

  chat(conn: Conn, text: string) {
    const now = this.time;
    if (now - conn.lastChat < 0.7) return;
    conn.lastChat = now;
    const clean = text.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);
    if (!clean) return;
    const p = conn.slot >= 0 ? this.players[conn.slot] : null;
    this.events.push({ e: 'chat', n: conn.login, t: p ? p.team : -1, text: clean, dead: !p || !p.alive });
  }

  // ---------- Покупки ----------

  canBuy(p: Player): boolean {
    if (!p.alive) return false;
    const inTime = this.phase === 'freeze' || (this.phase === 'live' && this.time < this.liveStart + BUY_TIME);
    return inTime && inRect(this.info.spawnZones[p.team], p.st.x, p.st.z);
  }

  buy(p: Player, item: string): boolean {
    if (!this.canBuy(p)) return false;
    const nt = NADE_TYPES.indexOf(item as (typeof NADE_TYPES)[number]);
    if (nt >= 0) {
      const def = WEAPON_BY_KEY[item];
      if (p.nades[nt] >= NADE_LIMIT[NADE_TYPES[nt]] || p.money < def.price) return false;
      p.money -= def.price;
      p.nades[nt]++;
      return true;
    }
    if (item === 'kit') {
      if (p.team !== TEAM_CT || p.hasKit || p.money < KIT_PRICE) return false;
      p.money -= KIT_PRICE;
      p.hasKit = true;
      return true;
    }
    if (item === 'armor') {
      if (p.armor >= 100 || p.money < ARMOR_PRICE) return false;
      p.money -= ARMOR_PRICE;
      p.armor = 100;
      return true;
    }
    if (item === 'helmet') {
      if (p.armor >= 100 && p.helmet) return false;
      const price = p.armor >= 100 ? HELMET_PRICE - ARMOR_PRICE : HELMET_PRICE;
      if (p.money < price) return false;
      p.money -= price;
      p.armor = 100;
      p.helmet = true;
      return true;
    }
    const def = WEAPON_BY_KEY[item];
    if (!def || def.slot === SLOT_KNIFE || p.money < def.price) return false;
    if (def.slot === SLOT_PRIMARY) {
      if (p.primary && p.primary.def === def) return false;
      p.primary = inst(def);
      p.slot = SLOT_PRIMARY;
    } else {
      if (p.pistol.def === def) return false;
      p.pistol = inst(def);
      p.slot = SLOT_PISTOL;
    }
    p.money -= def.price;
    p.reloadEnd = 0;
    return true;
  }

  // ---------- Голосование за карту ----------

  /** гранаты ботов нападения за раунд: кто уже закрыл дымом точку и сколько вспышек ушло */
  botUtil = { smoke: [false, false], flash: [0, 0], lastFlash: -10, ctSmokeAt: -10 };
  /** для тестов: всегда эта карта */
  lockMap: string | null = null;
  /** голос аккаунта → id карты */
  votes = new Map<string, string>();

  private startVote() {
    this.phase = 'vote';
    this.phaseEnd = this.time + VOTE_TIME;
    this.votes.clear();
    this.events.push({ e: 'vote' });
  }

  vote(conn: Conn, mapId: string) {
    if (this.phase !== 'vote' || !MAPS[mapId]) return;
    // голосуют игроки комнаты (в том числе ожидающие места)
    const isPlayer = this.players.some((p) => (p.conn === conn || p.pending === conn) && !p.isBot) || conn.pendingSlot >= 0;
    if (!isPlayer) return;
    this.votes.set(conn.accountId, mapId);
  }

  voteCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of Object.keys(MAPS)) out[id] = 0;
    for (const v of this.votes.values()) out[v] = (out[v] ?? 0) + 1;
    return out;
  }

  private finishVote() {
    const counts = this.voteCounts();
    const max = Math.max(...Object.values(counts));
    // большинство; при ничьей (и если никто не голосовал) — случайная из лидеров
    const leaders = Object.keys(counts).filter((k) => counts[k] === max);
    const winner = this.lockMap ?? this.rng.pick(leaders);
    this.events.push({ e: 'mapChosen', map: winner, votes: max });
    this.stats.mapsPlayed[winner] = (this.stats.mapsPlayed[winner] ?? 0) + 1;
    this.loadMap(winner);
    this.startMatch();
  }

  // ---------- Матч и раунды ----------

  startMatch() {
    this.scores = [0, 0];
    this.lossStreak = [0, 0];
    this.roundNum = 0;
    this.halfDone = false;
    for (const p of this.players) {
      p.money = START_MONEY;
      p.primary = null;
      p.pistol = inst(DEFAULT_PISTOL);
      p.armor = 0;
      p.helmet = false;
      p.hasKit = false;
      p.kills = 0;
      p.deaths = 0;
      p.nades = [0, 0, 0];
    }
    // команды по слотам: первая половина — нападение
    for (const p of this.players) p.team = p.id < TEAM_SIZE ? TEAM_T : TEAM_CT;
    this.startRound();
  }

  private startRound() {
    if (this.roundNum === HALF_ROUNDS && !this.halfDone) {
      this.halfDone = true;
      for (const p of this.players) {
        p.team = (1 - p.team) as Team;
        p.money = START_MONEY;
        p.primary = null;
        p.pistol = inst(DEFAULT_PISTOL);
        p.armor = 0;
        p.helmet = false;
      p.hasKit = false;
        if (!p.isBot) p.agent = p.loadout.agent[p.team] ?? 0;
      }
      this.scores = [this.scores[1], this.scores[0]];
      this.lossStreak = [0, 0];
      this.events.push({ e: 'half' });
    }
    this.roundNum++;
    // Ожидающие игроки занимают места ботов
    for (const p of this.players) if (p.pending) this.replaceBot(p, p.pending);
    this.fillFromQueue();

    this.bomb = { status: 'none', carrier: -1, x: 0, y: 0, z: 0, site: -1, explodeAt: 0, defuser: -1 };
    this.nadesInFlight = [];
    this.smokes = [];
    this.drops = [];
    // стены восстанавливаются в начале раунда
    this.chips = [];
    this.chipsPerBlock.clear();
    this.botUtil = { smoke: [false, false], flash: [0, 0], lastFlash: -10, ctSmokeAt: -10 };
    const spawnIdx = [0, 0];
    const order = [...this.info.spawns[0].keys()];
    const shuffled: [number[], number[]] = [this.shuffle(order.slice()), this.shuffle(order.slice())];
    for (const p of this.players) {
      const [sx, sz] = this.info.spawns[p.team][shuffled[p.team][spawnIdx[p.team]++ % shuffled[p.team].length]];
      p.st = newPState(sx, 0.5, sz);
      p.yaw = p.team === TEAM_T ? Math.PI : 0;
      p.pitch = 0;
      p.alive = true;
      p.hp = 100;
      p.wounds = [];
      p.exploded = false;
      p.hasBomb = false;
      p.useProgress = 0;
      p.reloadEnd = 0;
      p.recoil = 0;
      p.nextFire = p.simTime;
      p.slot = p.primary ? SLOT_PRIMARY : SLOT_PISTOL;
      if (p.primary) {
        p.primary.mag = p.primary.def.mag;
        p.primary.reserve = p.primary.def.reserve;
      }
      p.pistol.mag = p.pistol.def.mag;
      p.pistol.reserve = p.pistol.def.reserve;
      p.visUntil.fill(0);
      p.blindUntil = 0;
      p.cmdQueue.length = 0;
    }
    const ts = this.players.filter((p) => p.team === TEAM_T);
    const humansT = ts.filter((p) => !p.isBot);
    const carrier = humansT.length && this.rng.next() < 0.5 ? this.rng.pick(humansT) : this.rng.pick(ts);
    carrier.hasBomb = true;
    this.bomb.status = 'carried';
    this.bomb.carrier = carrier.id;
    this.tPlan = this.rng.int(3);
    this.phase = 'freeze';
    this.phaseEnd = this.time + FREEZE_TIME;
    for (const p of this.players) p.bot?.onRoundStart();
    this.events.push({ e: 'roundStart', rn: this.roundNum });
    this.broadcastFull();
  }

  private shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private endRound(winner: Team, why: string) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.scores[winner]++;
    this.stats.roundsWon[winner]++;
    this.stats.reasons[why] = (this.stats.reasons[why] ?? 0) + 1;
    const loser = (1 - winner) as Team;
    this.lossStreak[winner] = 0;
    const lossReward = Math.min(LOSS_REWARD + this.lossStreak[loser] * LOSS_BONUS_STEP, LOSS_REWARD_MAX);
    this.lossStreak[loser]++;
    const planted = this.bomb.status === 'planted' || this.bomb.status === 'exploded' || this.bomb.status === 'defused';
    for (const p of this.players) {
      let add = p.team === winner ? WIN_REWARD : lossReward;
      if (p.team === TEAM_T && loser === TEAM_T && planted) add += PLANT_REWARD;
      p.money = Math.min(MAX_MONEY, p.money + add);
    }
    this.events.push({ e: 'roundEnd', w: winner, why });
    if (this.scores[winner] >= WIN_ROUNDS) {
      this.phase = 'matchEnd';
      this.phaseEnd = this.time + MATCH_END_TIME;
      this.stats.matches++;
      this.stats.matchWins[winner]++;
      this.events.push({ e: 'matchEnd', w: winner });
    } else {
      this.phase = 'roundEnd';
      this.phaseEnd = this.time + ROUND_END_TIME;
    }
  }

  private aliveCount(team: Team): number {
    let n = 0;
    for (const p of this.players) if (p.team === team && p.alive) n++;
    return n;
  }

  private checkElimination() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    if (this.aliveCount(TEAM_CT) === 0) this.endRound(TEAM_T, 'Все защитники убиты');
    else if (this.aliveCount(TEAM_T) === 0 && this.phase === 'live') this.endRound(TEAM_CT, 'Все нападающие убиты');
  }

  private updateRound() {
    const now = this.time;
    switch (this.phase) {
      case 'freeze':
        if (now >= this.phaseEnd) {
          this.phase = 'live';
          this.liveStart = now;
          this.phaseEnd = now + ROUND_TIME;
        }
        break;
      case 'live':
        if (now >= this.phaseEnd) this.endRound(TEAM_CT, 'Время вышло');
        break;
      case 'planted':
        if (now >= this.bomb.explodeAt) {
          this.bomb.status = 'exploded';
          this.events.push({ e: 'explode', p: [this.bomb.x, this.bomb.y, this.bomb.z] });
          // взрыв убивает всех рядом
          for (const p of this.players) {
            if (!p.alive) continue;
            const d = Math.hypot(p.st.x - this.bomb.x, p.st.z - this.bomb.z);
            if (d < 12) this.damage(p, null, d < 6 ? 500 : Math.round(120 * (1 - d / 12)), PART_TORSO, [p.st.x - this.bomb.x, 1, p.st.z - this.bomb.z], KNIFE, null);
          }
          this.endRound(TEAM_T, 'Бомба взорвана');
        }
        break;
      case 'roundEnd':
        if (now >= this.phaseEnd) {
          this.startRound();
        }
        break;
      case 'matchEnd':
        if (now >= this.phaseEnd) {
          if (this.draining) {
            this.onDrained?.();
            return;
          }
          this.startVote();
        }
        break;
      case 'vote': {
        // все живые игроки проголосовали — не ждём до конца
        const humans = this.players.filter((p) => !p.isBot && p.conn).map((p) => p.accountId!);
        if (humans.length && humans.every((id) => this.votes.has(id)) && this.phaseEnd - now > 3) this.phaseEnd = now + 3;
        if (now >= this.phaseEnd) this.finishVote();
        break;
      }
    }
    this.updateBomb();
  }

  private updateBomb() {
    const b = this.bomb;
    if (b.status === 'carried') {
      const c = this.players[b.carrier];
      if (!c || !c.alive || c.team !== TEAM_T) {
        b.status = 'dropped';
        if (c) {
          c.hasBomb = false;
          b.x = c.st.x;
          b.y = c.st.y;
          b.z = c.st.z;
        }
      } else {
        b.x = c.st.x;
        b.y = c.st.y;
        b.z = c.st.z;
        // закладка
        if (this.phase === 'live' && c.lastButtons & BTN_USE && c.st.onGround) {
          const site = this.siteAt(c.st.x, c.st.z);
          if (site >= 0) {
            c.useProgress += DT;
            if (c.useProgress >= PLANT_TIME) {
              b.status = 'planted';
              b.site = site;
              b.carrier = -1;
              c.hasBomb = false;
              c.useProgress = 0;
              b.explodeAt = this.time + BOMB_TIMER;
              this.phase = 'planted';
              c.money = Math.min(MAX_MONEY, c.money + 300);
              this.events.push({ e: 'plant', p: [b.x, b.y, b.z], site });
              for (const p of this.players) p.bot?.onBombPlanted();
            }
          } else c.useProgress = 0;
        } else c.useProgress = 0;
      }
    } else if (b.status === 'dropped') {
      for (const p of this.players) {
        if (p.alive && p.team === TEAM_T && Math.hypot(p.st.x - b.x, p.st.z - b.z) < 1.0 && Math.abs(p.st.y - b.y) < 1.5) {
          b.status = 'carried';
          b.carrier = p.id;
          p.hasBomb = true;
          break;
        }
      }
    } else if (b.status === 'planted' && this.phase === 'planted') {
      let defuser: Player | null = b.defuser >= 0 ? this.players[b.defuser] : null;
      if (defuser && !(defuser.alive && defuser.team === TEAM_CT && defuser.lastButtons & BTN_USE && this.nearBomb(defuser))) {
        defuser.useProgress = 0;
        defuser = null;
        b.defuser = -1;
      }
      if (!defuser) {
        for (const p of this.players) {
          if (p.alive && p.team === TEAM_CT && p.lastButtons & BTN_USE && p.st.onGround && this.nearBomb(p)) {
            defuser = p;
            b.defuser = p.id;
            p.useProgress = 0;
            break;
          }
        }
      }
      if (defuser) {
        defuser.useProgress += DT;
        if (defuser.useProgress >= (defuser.hasKit ? DEFUSE_TIME_KIT : DEFUSE_TIME)) {
          b.status = 'defused';
          defuser.useProgress = 0;
          defuser.money = Math.min(MAX_MONEY, defuser.money + 300);
          this.events.push({ e: 'defuse' });
          this.endRound(TEAM_CT, 'Бомба обезврежена');
        }
      }
    }
  }

  nearBomb(p: Player): boolean {
    return Math.hypot(p.st.x - this.bomb.x, p.st.z - this.bomb.z) < DEFUSE_RANGE && Math.abs(p.st.y - this.bomb.y) < 1.5;
  }

  siteAt(x: number, z: number): number {
    for (let i = 0; i < 2; i++) if (inRect(this.info.sites[i], x, z)) return i;
    return -1;
  }

  // ---------- Тик ----------

  step() {
    const t0 = performance.now();
    this.tick++;
    const now = this.time;
    for (const p of this.players) {
      if (p.isBot && p.bot) {
        this.applyCmd(p, p.bot.think());
      } else {
        // до двух команд за тик, чтобы догнать после задержки
        for (let i = 0; i < 2 && p.cmdQueue.length; i++) this.applyCmd(p, p.cmdQueue.shift()!);
        if (p.pending && !p.alive) this.replaceBot(p, p.pending);
        if (!p.conn && now - p.disconnectedAt > RECONNECT_HOLD) {
          this.events.push({ e: 'info', text: `${p.name} заменён ботом` });
          this.makeBot(p);
          p.bot!.onRoundStart();
          this.fillFromQueue();
        }
      }
      // перезарядка
      const wi = p.weaponInst;
      if (p.reloadEnd > 0 && p.simTime >= p.reloadEnd && wi) {
        const need = wi.def.mag - wi.mag;
        const take = Math.min(need, wi.reserve);
        wi.mag += take;
        wi.reserve -= take;
        p.reloadEnd = 0;
      }
    }
    this.updateNades();
    this.updateDrops();
    this.recordHistory();
    this.updateRound();
    this.flushEvents();
    if (Math.floor((this.tick * SNAPSHOT_RATE) / TICK_RATE) !== Math.floor(((this.tick - 1) * SNAPSHOT_RATE) / TICK_RATE)) this.sendSnapshots();
    if (now - this.lastStateSent >= 0.25) {
      this.lastStateSent = now;
      this.broadcastState();
    }
    this.tickTimeMs = performance.now() - t0;
  }

  private applyCmd(p: Player, cmd: UserCmd) {
    if (cmd.seq <= p.lastSeq) return;
    p.lastSeq = cmd.seq;
    p.simTime += DT;
    p.yaw = cmd.yaw;
    p.pitch = Math.max(-1.55, Math.min(1.55, cmd.pitch));
    if (!p.alive) {
      p.lastButtons = 0;
      return;
    }
    const canMove = this.phase !== 'freeze' && this.phase !== 'vote';
    stepPlayer(p.st, cmd.buttons, p.yaw, this.info.map, canMove, p.weapon.speed);
    p.recoil *= Math.exp(-DT * 6);

    // Смена оружия (гранаты — только если они есть)
    if (p.slot >= SLOT_HE && p.nades[p.slot - SLOT_HE] <= 0) p.slot = p.gunSlot;
    if (cmd.slot !== p.slot && cmd.slot <= SLOT_HE + 2) {
      const ok = cmd.slot >= SLOT_HE ? p.nades[cmd.slot - SLOT_HE] > 0 : cmd.slot !== SLOT_PRIMARY || !!p.primary;
      if (ok) {
        p.slot = cmd.slot;
        p.reloadEnd = 0;
        p.nextFire = Math.max(p.nextFire, p.simTime + 0.35);
      }
    }
    const wi = p.weaponInst;
    const def = p.weapon;
    // Перезарядка
    if (cmd.buttons & BTN_RELOAD && wi && p.reloadEnd === 0 && wi.mag < def.mag && wi.reserve > 0) {
      p.reloadEnd = p.simTime + def.reload;
      this.events.push({ e: 'reload', s: p.id });
    }
    const pressed = cmd.buttons & ~p.lastButtons;
    // Выбросить оружие (G) и подобрать с земли (E)
    if (pressed & BTN_DROP) this.dropWeapon(p, true);
    if (pressed & BTN_USE) this.tryPickup(p);
    // Бросок гранаты
    if (def.kind === 'grenade') {
      if (pressed & BTN_FIRE && this.phase !== 'freeze' && this.phase !== 'vote' && p.simTime >= p.nextFire) this.throwGrenade(p);
      p.lastButtons = cmd.buttons;
      return;
    }
    // Стрельба
    if (cmd.buttons & BTN_FIRE && this.phase !== 'freeze' && this.phase !== 'vote' && p.reloadEnd === 0 && p.simTime >= p.nextFire && !(cmd.buttons & BTN_USE)) {
      if (def.auto || !(p.lastButtons & BTN_FIRE)) {
        if (wi && wi.mag <= 0) {
          if (wi.reserve > 0) {
            p.reloadEnd = p.simTime + def.reload;
            this.events.push({ e: 'reload', s: p.id });
          }
        } else {
          this.fire(p, cmd, def, wi);
        }
      }
    }
    p.lastButtons = cmd.buttons;
  }

  private fire(p: Player, cmd: UserCmd, def: WeaponDef, wi: WeaponInst | null) {
    if (wi) wi.mag--;
    p.nextFire = p.simTime + def.interval;
    const speed = Math.hypot(p.st.vx, p.st.vz);
    const spread = def.spread + (speed / RUN_SPEED) * def.moveSpread + (p.st.onGround ? 0 : 0.08) + p.recoil * (p.st.crouch ? 0.7 : 1);
    p.recoil = Math.min(p.recoil + def.recoil, def.recoilMax);
    const [ex, ey, ez] = p.eye();
    const vt = Math.max(this.tick - MAX_LAG_COMP_TICKS, Math.min(this.tick, cmd.viewTick));
    const seed = p.id * 1000003 + cmd.seq;
    const hitsBy = new Map<number, number>();
    for (let k = 0; k < def.pellets; k++) {
      const d = shotDirection(p.yaw, p.pitch, spread, seed, k, this.dir);
      let maxT = def.range;
      let h: 0 | 1 | 2 = 0;
      if (raycastMap(this.info.map, ex, ey, ez, d[0], d[1], d[2], maxT, this.mapHit)) {
        maxT = this.mapHit.t;
        h = 1;
      }
      let victim: Player | null = null;
      let bh = { ...this.bodyHit };
      for (const q of this.players) {
        if (q === p || !q.alive || q.team === p.team) continue;
        if (!this.poseAt(q, vt)) continue;
        if (raycastBody(this.pose, ex, ey, ez, d[0], d[1], d[2], maxT, this.bodyHit)) {
          maxT = this.bodyHit.t;
          victim = q;
          bh = { ...this.bodyHit };
          h = 2;
        }
      }
      const end: [number, number, number] = [ex + d[0] * maxT, ey + d[1] * maxT, ez + d[2] * maxT];
      if (def.kind !== 'knife' && def.pellets === 1) {
        this.stats.shots++;
        if (victim) this.stats.hits++;
      }
      if (def.kind !== 'knife') this.events.push({ e: 'shot', s: p.id, a: [ex, ey, ez], b: end, h });
      if (h === 1 && def.kind !== 'knife') this.tryChip(def, end);
      if (victim) {
        // рана: вход, а при пробитии торса/головы — выход
        if (victim.wounds.length / 6 < MAX_WOUNDS) {
          const r = def.kind === 'shotgun' ? 1 : def.kind === 'sniper' ? 2 : 1;
          victim.wounds.push(bh.part, bh.ix, bh.iy, bh.iz, r, 0);
          this.events.push({ e: 'wound', v: victim.id, p: bh.part, x: bh.ix, y: bh.iy, z: bh.iz, r, x2: 0 });
          if ((bh.part === PART_TORSO || bh.part === PART_HEAD) && def.kind !== 'shotgun' && def.kind !== 'knife' && victim.wounds.length / 6 < MAX_WOUNDS) {
            victim.wounds.push(bh.part, bh.ex, bh.ey, bh.ez, r + 1, 1);
            this.events.push({ e: 'wound', v: victim.id, p: bh.part, x: bh.ex, y: bh.ey, z: bh.ez, r: r + 1, x2: 1 });
          }
        }
        const dmg = def.damage * PART_DAMAGE[bh.part];
        hitsBy.set(victim.id, (hitsBy.get(victim.id) ?? 0) + 1);
        this.damage(victim, p, dmg, bh.part, [d[0], d[1], d[2]], def, [ex, ey, ez]);
      }
    }
    // боты слышат выстрелы
    for (const q of this.players) q.bot?.hear(ex, ez, 30, p);
  }

  damage(victim: Player, attacker: Player | null, dmg: number, part: number, dir: [number, number, number], def: WeaponDef, from: [number, number, number] | null) {
    if (!victim.alive) return;
    if (victim.armor > 0 && (part !== PART_HEAD || victim.helmet) && attacker) {
      const absorbed = dmg * (1 - def.armorPen);
      victim.armor = Math.max(0, victim.armor - Math.round(absorbed * 0.5));
      dmg *= def.armorPen;
    }
    const d = Math.max(1, Math.round(dmg));
    victim.hp -= d;
    if (from) {
      victim.lastHurtFrom = from;
      victim.lastHurtAt = this.time;
      this.events.push({ e: 'hurt', v: victim.id, from, dmg: d });
      victim.bot?.onHurt(from);
    }
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths++;
      victim.diedAt = this.time;
      victim.deathYaw = victim.yaw;
      victim.useProgress = 0;
      const hs = part === PART_HEAD && !!attacker;
      const explode = hs && rand01(this.tick * 7919 + victim.id * 31 + (attacker?.id ?? 0)) < HEAD_EXPLODE_CHANCE;
      victim.exploded = explode;
      this.stats.kills++;
      if (def.kind === 'grenade') this.stats.nadeKills++;
      if (hs) this.stats.headshots++;
      if (explode) this.stats.explodes++;
      if (attacker && attacker !== victim) {
        attacker.kills++;
        attacker.money = Math.min(MAX_MONEY, attacker.money + def.killReward);
      }
      // оружие падает на землю: основное, а если его нет — купленный пистолет
      if (victim.primary) {
        victim.slot = SLOT_PRIMARY;
        this.dropWeapon(victim, false);
      } else if (victim.pistol.def !== DEFAULT_PISTOL) this.addDrop(victim.pistol, victim.st.x, victim.st.y, victim.st.z);
      victim.primary = null;
      victim.pistol = inst(DEFAULT_PISTOL);
      victim.nades = [0, 0, 0];
      victim.armor = 0;
      victim.helmet = false;
      victim.hasKit = false;
      this.events.push({ e: 'kill', k: attacker ? attacker.id : -1, v: victim.id, w: def.id, hs, ex: explode, d: dir, p: part, at: [victim.st.x, victim.st.y, victim.st.z, victim.yaw] });
      for (const q of this.players) q.bot?.onTeammateDeath(victim);
      if (victim.hasBomb) {
        victim.hasBomb = false;
        this.bomb.status = 'dropped';
        this.bomb.carrier = -1;
        this.bomb.x = victim.st.x;
        this.bomb.y = victim.st.y;
        this.bomb.z = victim.st.z;
      }
      this.checkElimination();
    }
  }

  // ---------- Сколы стен (только картинка) ----------

  /** все сколы раунда подряд, по 10 чисел */
  chips: number[] = [];
  private chipsPerBlock = new Map<number, number>();

  private tryChip(def: WeaponDef, end: [number, number, number]) {
    const h = this.mapHit;
    if (this.chips.length / 10 >= MAX_CHIPS_PER_ROUND) return;
    if (!chippable(this.info.map, h.vx, h.vy, h.vz)) return;
    const chance = def.kind === 'shotgun' ? 0.25 : def.kind === 'sniper' ? 1 : def.kind === 'rifle' ? 0.7 : 0.5;
    if (this.rng.next() > chance) return;
    const key = blockKey(h.vx, h.vy, h.vz);
    const n = this.chipsPerBlock.get(key) ?? 0;
    if (n >= MAX_CHIPS_PER_BLOCK) return;
    this.chipsPerBlock.set(key, n + 1);
    const radius = def.kind === 'sniper' ? 1.5 : def.kind === 'rifle' ? 1 : def.kind === 'shotgun' ? 0.5 : 0.5 + this.rng.next() * 0.5;
    const op = chipToArray(makeChip(h.vx, h.vy, h.vz, end[0], end[1], end[2], h.nx, h.ny, h.nz, radius));
    this.chips.push(...op);
    this.events.push({ e: 'chip', c: op });
  }

  // ---------- Гранаты ----------

  private throwGrenade(p: Player) {
    const type = p.slot - SLOT_HE;
    if (p.nades[type] <= 0) return;
    p.nades[type]--;
    p.nextFire = p.simTime + 0.8;
    const [ex, ey, ez] = p.eye();
    const st = throwNade(ex, ey, ez, p.yaw, p.pitch, p.st.vx, p.st.vz);
    const n = { id: this.nextNadeId++, owner: p.id, team: p.team, type, st, thrownAt: this.time };
    this.nadesInFlight.push(n);
    this.stats.nades[type]++;
    this.events.push({ e: 'nade', id: n.id, s: p.id, type, tick: this.tick, p: [st.x, st.y, st.z], v: [st.vx, st.vy, st.vz] });
    // после броска — снова оружие, если гранат этого типа больше нет
    if (p.nades[type] <= 0) p.slot = p.gunSlot;
    for (const q of this.players) q.bot?.hear(ex, ez, 20, p);
  }

  private updateNades() {
    const now = this.time;
    for (let i = this.nadesInFlight.length - 1; i >= 0; i--) {
      const n = this.nadesInFlight[i];
      stepNade(n.st, this.info.map);
      const age = now - n.thrownAt;
      const pop = n.type === 2 ? (n.st.resting && age > 0.5) || age > 3 : age >= NADE_FUSE;
      if (!pop) continue;
      this.nadesInFlight.splice(i, 1);
      const { x, y, z } = n.st;
      this.events.push({ e: 'boom', id: n.id, type: n.type, p: [x, y, z] });
      const owner = this.players[n.owner];
      if (n.type === 0) this.explodeHE(owner, n.team, x, y, z);
      else if (n.type === 1) this.explodeFlash(x, y, z);
      else this.smokes.push({ x, y, z, start: now, end: now + SMOKE_TIME });
      for (const q of this.players) q.bot?.hear(x, z, 30, owner);
    }
    if (this.smokes.length) this.smokes = this.smokes.filter((s) => s.end > now);
  }

  /** Сколы от взрыва: лучи во все стороны, крупные выбоины рядом, мелкие — дальше. Пол тоже. */
  private blastChips(x: number, y: number, z: number) {
    const map = this.info.map;
    const RAYS = 96;
    let made = 0;
    let floorMade = 0;
    for (let i = 0; i < RAYS && made < 36; i++) {
      // равномерные направления (спираль Фибоначчи)
      const k = (i + 0.5) / RAYS;
      const dy = 1 - 2 * k;
      const r = Math.sqrt(1 - dy * dy);
      const a = i * 2.39996323;
      const dx = Math.cos(a) * r,
        dz = Math.sin(a) * r;
      if (!raycastMap(map, x, y + 0.15, z, dx, dy, dz, 3.4, this.mapHit)) continue;
      const h = this.mapHit;
      const t = h.t;
      if (this.chips.length / 10 >= MAX_CHIPS_PER_ROUND) return;
      if (!chippable(map, h.vx, h.vy, h.vz, true)) continue;
      // дальние поверхности задеваются реже; пол — реже стен (лучей вниз слишком много)
      if (this.rng.next() > 1.15 - t / 3.4) continue;
      if (h.vy === 0 && (floorMade >= 10 || this.rng.next() < 0.55)) continue;
      if (h.vy === 0) floorMade++;
      const key = blockKey(h.vx, h.vy, h.vz);
      const n = this.chipsPerBlock.get(key) ?? 0;
      if (n >= MAX_CHIPS_PER_BLOCK) continue;
      this.chipsPerBlock.set(key, n + 1);
      const radius = Math.max(1, 2.2 - t * 0.45);
      const op = chipToArray(makeChip(h.vx, h.vy, h.vz, x + dx * t, y + 0.15 + dy * t, z + dz * t, h.nx, h.ny, h.nz, radius));
      this.chips.push(...op);
      this.events.push({ e: 'chip', c: op });
      made++;
    }
  }

  private explodeHE(owner: Player, team: Team, x: number, y: number, z: number) {
    const def = WEAPON_BY_KEY.he;
    this.blastChips(x, y, z);
    for (const v of this.players) {
      if (!v.alive || v.team === team) continue;
      const dx = v.st.x - x,
        dz = v.st.z - z,
        cy = v.st.y + 1.0;
      const d = Math.hypot(dx, cy - y, dz);
      if (d > HE_RADIUS || !lineOfSight(this.info.map, x, y + 0.3, z, v.st.x, cy, v.st.z)) continue;
      const dmg = HE_MAX_DAMAGE * (1 - d / HE_RADIUS);
      if (dmg < 1) continue;
      // осколки: несколько ран на стороне тела, обращённой к взрыву (перед тела — z = 0)
      const frontToBlast = -Math.sin(v.yaw) * -dx + -Math.cos(v.yaw) * -dz > 0;
      for (let k = 0; k < 3 && v.wounds.length / 6 < MAX_WOUNDS; k++) {
        const leg = k === 2;
        const part = leg ? PART_LEG_L + this.rng.int(2) : PART_TORSO;
        const px = leg ? this.rng.int(4) : this.rng.int(8);
        const py = leg ? this.rng.int(13) : this.rng.int(11);
        const pz = frontToBlast ? 0 : leg ? 3 : 4;
        v.wounds.push(part, px, py, pz, 1, 0);
        this.events.push({ e: 'wound', v: v.id, p: part, x: px, y: py, z: pz, r: 1, x2: 0 });
      }
      const l = Math.max(0.01, Math.hypot(dx, dz));
      this.damage(v, owner, dmg, PART_TORSO, [dx / l, 0.4, dz / l], def, [x, y, z]);
    }
  }

  private explodeFlash(x: number, y: number, z: number) {
    for (const v of this.players) {
      if (!v.alive) continue;
      const [ex, ey, ez] = v.eye();
      const dx = x - ex,
        dy = y + 0.2 - ey,
        dz = z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > FLASH_RANGE || !lineOfSight(this.info.map, x, y + 0.2, z, ex, ey, ez) || smokeBlocks(this.smokes, this.time, x, y + 0.2, z, ex, ey, ez)) continue;
      // насколько вспышка перед глазами
      const cp = Math.cos(v.pitch);
      const dot = (-Math.sin(v.yaw) * cp * dx + Math.sin(v.pitch) * dy - Math.cos(v.yaw) * cp * dz) / Math.max(d, 0.01);
      const base = dot > 0.5 ? 3 : dot > 0 ? 1.6 : 0.5;
      const dur = base * (1 - (d / FLASH_RANGE) * 0.6);
      v.blindUntil = Math.max(v.blindUntil, this.time + dur);
      if (dur > 1) this.stats.blinded++;
      this.events.push({ e: 'flash', v: v.id, dur });
    }
  }

  // ---------- Оружие на земле ----------

  /** Высота пола под точкой. */
  private floorAt(x: number, y: number, z: number): number {
    const m = this.info.map;
    let vy = Math.floor((y + 0.4) / VOXEL);
    const vx = Math.floor(x / VOXEL),
      vz = Math.floor(z / VOXEL);
    while (vy > 0 && m.get(vx, vy - 1, vz) === 0) vy--;
    return vy * VOXEL;
  }

  private addDrop(inst: WeaponInst, x: number, y: number, z: number) {
    if (this.info.map.solidAt(x, y + 0.6, z)) return;
    this.drops.push({ id: this.nextDropId++, inst, x, y: this.floorAt(x, y, z), z, r: this.rng.next() * Math.PI * 2 });
    if (this.drops.length > MAX_DROPS) this.drops.shift();
  }

  /** Выбросить оружие в руках (основное или купленный пистолет). manual — вперёд по взгляду. */
  dropWeapon(p: Player, manual: boolean) {
    let inst: WeaponInst | null = null;
    if (p.slot === SLOT_PRIMARY && p.primary) {
      inst = p.primary;
      p.primary = null;
    } else if (p.slot === SLOT_PISTOL && manual && p.pistol.def !== DEFAULT_PISTOL) {
      inst = p.pistol;
      p.pistol = { def: DEFAULT_PISTOL, mag: DEFAULT_PISTOL.mag, reserve: 0 };
    }
    if (!inst) return;
    const fx = -Math.sin(p.yaw),
      fz = -Math.cos(p.yaw);
    let x = p.st.x + (manual ? fx * 1.3 : (this.rng.next() - 0.5) * 0.6),
      z = p.st.z + (manual ? fz * 1.3 : (this.rng.next() - 0.5) * 0.6);
    if (this.info.map.solidAt(x, p.st.y + 0.6, z)) {
      x = p.st.x;
      z = p.st.z;
    }
    this.addDrop(inst, x, p.st.y, z);
    if (p.slot === SLOT_PRIMARY) p.slot = SLOT_PISTOL;
    p.reloadEnd = 0;
  }

  private takeDrop(p: Player, idx: number) {
    const d = this.drops[idx];
    this.drops.splice(idx, 1);
    if (d.inst.def.slot === SLOT_PRIMARY) {
      if (p.primary) this.addDrop(p.primary, d.x, d.y, d.z);
      p.primary = d.inst;
      p.slot = SLOT_PRIMARY;
    } else {
      if (p.pistol.def !== DEFAULT_PISTOL) this.addDrop(p.pistol, d.x, d.y, d.z);
      p.pistol = d.inst;
      p.slot = SLOT_PISTOL;
    }
    p.reloadEnd = 0;
    this.events.push({ e: 'pickup', s: p.id, w: d.inst.def.id });
  }

  /** E рядом с оружием на земле: обмен на оружие того же слота. */
  private tryPickup(p: Player) {
    if (!p.alive) return;
    if (p.hasBomb && this.siteAt(p.st.x, p.st.z) >= 0) return; // E — закладка
    if (p.team === TEAM_CT && this.bomb.status === 'planted' && this.nearBomb(p)) return; // E — обезвреживание
    let best = -1,
      bestD = 1.5;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const dist = Math.hypot(d.x - p.st.x, d.z - p.st.z);
      if (dist < bestD && Math.abs(d.y - p.st.y) < 1.2) {
        best = i;
        bestD = dist;
      }
    }
    if (best >= 0) this.takeDrop(p, best);
  }

  /** Подбор основного оружия на ходу, если слот пуст. */
  private updateDrops() {
    if (!this.drops.length) return;
    for (const p of this.players) {
      if (!p.alive || p.primary) continue;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        if (d.inst.def.slot === SLOT_PRIMARY && Math.hypot(d.x - p.st.x, d.z - p.st.z) < 0.9 && Math.abs(d.y - p.st.y) < 1.2) {
          this.takeDrop(p, i);
          break;
        }
      }
    }
  }

  // ---------- История для компенсации задержки ----------

  private recordHistory() {
    const slot = this.tick % HISTORY_TICKS;
    this.histTick[slot] = this.tick;
    const base = slot * MAX_PLAYERS * HIST_STRIDE;
    for (const p of this.players) {
      const o = base + p.id * HIST_STRIDE;
      this.hist[o] = p.st.x;
      this.hist[o + 1] = p.st.y;
      this.hist[o + 2] = p.st.z;
      this.hist[o + 3] = p.yaw;
      this.hist[o + 4] = p.pitch;
      this.hist[o + 5] = p.st.crouch ? 1 : 0;
      this.hist[o + 6] = p.alive ? 1 : 0;
    }
  }

  /** Поза игрока на момент viewTick (с интерполяцией между тиками). */
  private poseAt(p: Player, viewTick: number): boolean {
    const t0 = Math.floor(viewTick);
    const frac = viewTick - t0;
    const s0 = t0 % HISTORY_TICKS,
      s1 = (t0 + 1) % HISTORY_TICKS;
    if (this.histTick[s0] !== t0 || t0 >= this.tick) {
      computePose(p.st.x, p.st.y, p.st.z, p.yaw, p.pitch, p.st.crouch, this.pose);
      return true;
    }
    const o0 = s0 * MAX_PLAYERS * HIST_STRIDE + p.id * HIST_STRIDE;
    let o1 = o0;
    if (this.histTick[s1] === t0 + 1) o1 = s1 * MAX_PLAYERS * HIST_STRIDE + p.id * HIST_STRIDE;
    const h = this.hist;
    if (!h[o0 + 6]) return false;
    const lerp = (a: number, b: number) => a + (b - a) * frac;
    let dy = h[o1 + 3] - h[o0 + 3];
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    computePose(lerp(h[o0], h[o1]), lerp(h[o0 + 1], h[o1 + 1]), lerp(h[o0 + 2], h[o1 + 2]), h[o0 + 3] + dy * frac, lerp(h[o0 + 4], h[o1 + 4]), (frac < 0.5 ? h[o0 + 5] : h[o1 + 5]) > 0.5, this.pose);
    return true;
  }

  // ---------- Видимость ----------

  /** Видит ли a игрока b (линия от глаз до головы, груди или ног). */
  canSee(a: Player, b: Player): boolean {
    const [ax, ay, az] = a.eye();
    const bx = b.st.x,
      by = b.st.y,
      bz = b.st.z;
    const m = this.info.map;
    const hh = b.st.crouch ? 1.15 : 1.6;
    const now = this.time;
    const see = (ty: number) => lineOfSight(m, ax, ay, az, bx, ty, bz) && !smokeBlocks(this.smokes, now, ax, ay, az, bx, ty, bz);
    return see(by + hh) || see(by + hh * 0.65) || see(by + 0.3);
  }

  private visibleFor(viewer: Player, target: Player): boolean {
    if (!viewer.alive || viewer.team === target.team || !target.alive) return true;
    const now = this.time;
    if (target.visUntil[viewer.id] > now) return true;
    const d = Math.hypot(viewer.st.x - target.st.x, viewer.st.z - target.st.z);
    let vis = d < 3 || this.canSee(viewer, target);
    if (!vis) {
      // «скоро увидит»: проверка с упреждением по скорости
      const k = 0.15;
      const [ax, ay, az] = viewer.eye();
      const ax2 = ax + viewer.st.vx * k,
        az2 = az + viewer.st.vz * k,
        bx2 = target.st.x + target.st.vx * k,
        by2 = target.st.y + 1.4,
        bz2 = target.st.z + target.st.vz * k;
      vis = lineOfSight(this.info.map, ax2, ay, az2, bx2, by2, bz2) && !smokeBlocks(this.smokes, now, ax2, ay, az2, bx2, by2, bz2);
    }
    if (vis) target.visUntil[viewer.id] = now + 0.3;
    return vis;
  }

  // ---------- Рассылка ----------

  private sendSnapshots() {
    const ents: EntState[] = [];
    for (const conn of this.conns) {
      if (conn.buffered() > 64 * 1024) continue; // очередь забита: пропускаем устаревший снапшот
      const viewer = conn.slot >= 0 ? this.players[conn.slot] : null;
      ents.length = 0;
      for (const p of this.players) {
        if (viewer && p === viewer) continue;
        if (viewer && !this.visibleFor(viewer, p)) continue;
        ents.push(this.entState(p));
      }
      const own = newOwnState();
      if (viewer) {
        own.present = true;
        own.x = viewer.st.x;
        own.y = viewer.st.y;
        own.z = viewer.st.z;
        own.vx = viewer.st.vx;
        own.vy = viewer.st.vy;
        own.vz = viewer.st.vz;
        own.flags = this.flagsOf(viewer);
        own.hp = viewer.hp;
        own.armor = viewer.armor;
        own.weapon = viewer.weapon.id;
        const wi = viewer.weaponInst;
        own.mag = wi ? wi.mag : 0;
        own.reserve = wi ? wi.reserve : 0;
        own.canMove = this.phase !== 'freeze' && this.phase !== 'vote';
      }
      const buf = new ArrayBuffer(snapshotSize(ents.length));
      encodeSnapshot({ tick: this.tick, ackSeq: viewer ? viewer.lastSeq : 0, own, ents }, buf);
      conn.sendBin(buf);
    }
  }

  private flagsOf(p: Player): number {
    return (p.alive ? SF_ALIVE : 0) | (p.st.crouch ? SF_CROUCH : 0) | (p.st.onGround ? SF_ONGROUND : 0) | (p.useProgress > 0 ? SF_USING : 0) | (p.reloadEnd > 0 ? SF_RELOADING : 0);
  }

  private entState(p: Player): EntState {
    return { id: p.id, flags: this.flagsOf(p), x: p.st.x, y: p.st.y, z: p.st.z, yaw: p.yaw, pitch: p.pitch, weapon: p.weapon.id };
  }

  private flushEvents() {
    if (!this.events.length) return;
    const msg: ServerMsg = { t: 'ev', e: this.events };
    for (const c of this.conns) c.sendJson(msg);
    this.events = [];
  }

  publicState(forTeam: number): RoomState {
    const b = this.bomb;
    // позицию бомбы знают нападающие, а после закладки — все
    const bombKnown = b.status === 'planted' || b.status === 'exploded' || b.status === 'defused' || forTeam === TEAM_T || forTeam === -2;
    const pl: PublicPlayer[] = this.players.map((p) => ({
      i: p.id,
      n: p.name,
      t: p.team,
      b: p.isBot,
      a: p.alive,
      k: p.kills,
      d: p.deaths,
      hp: forTeam === p.team || forTeam === -2 || !p.alive ? p.hp : -1,
      m: forTeam === p.team ? p.money : -1,
      w: p.weapon.id,
      ag: p.agent,
      sk: p.skin,
      c: p.isBot || !!p.conn,
      bomb: p.hasBomb && (forTeam === TEAM_T || forTeam === -2),
      kit: p.hasKit && (forTeam === p.team || forTeam === -2),
    }));
    return {
      t: 'st',
      ph: this.phase,
      tl: Math.max(0, (this.phase === 'planted' ? b.explodeAt : this.phaseEnd) - this.time),
      rn: this.roundNum,
      sc: [this.scores[0], this.scores[1]],
      bomb: { s: b.status, c: bombKnown ? b.carrier : -1, p: bombKnown && b.status !== 'none' ? [b.x, b.y, b.z] : null, site: b.site },
      pl,
      spec: this.spectators.size,
      map: this.mapId,
      half: this.halfDone,
      votes: this.voteCounts(),
      drops: this.drops.map((d) => ({ i: d.id, w: d.inst.def.id, x: d.x, y: d.y, z: d.z, r: d.r })),
    };
  }

  private broadcastState() {
    const byTeam = [this.publicState(TEAM_T), this.publicState(TEAM_CT)];
    const spec = this.publicState(-2);
    for (const c of this.conns) {
      const p = c.slot >= 0 ? this.players[c.slot] : null;
      // мёртвые и наблюдатели видят всё, как в спектаторском режиме
      c.sendJson(p ? (p.alive ? byTeam[p.team] : byTeam[p.team]) : spec);
      if (p) c.sendJson({ t: 'me', id: p.id, team: p.team, money: p.money, spectator: false, queue: 0, pri: p.primary ? p.primary.def.id : -1, pis: p.pistol.def.id, nades: [...p.nades] as [number, number, number], kit: p.hasKit });
      else c.sendJson({ t: 'me', id: -1, team: c.pendingSlot >= 0 ? this.players[c.pendingSlot].team : -1, money: 0, pri: -1, pis: 1, nades: [0, 0, 0], kit: false, spectator: true, queue: c.pendingSlot >= 0 ? 0 : [...this.spectators].filter((s) => s.pendingSlot < 0).indexOf(c) + 1 });
    }
  }

  fullState(conn: Conn): FullState {
    return {
      t: 'full',
      you: conn.slot,
      tick: this.tick,
      map: this.mapId,
      corpses: this.players.filter((p) => !p.alive).map((p) => ({ i: p.id, x: p.st.x, y: p.st.y, z: p.st.z, yaw: p.deathYaw, ex: p.exploded })),
      wounds: this.players.filter((p) => p.wounds.length).map((p) => ({ i: p.id, ops: p.wounds.slice() })),
      tracers: true,
      smokes: this.smokes.map((s) => ({ x: s.x, y: s.y, z: s.z, left: s.end - this.time })),
      chips: this.chips.slice(),
    };
  }

  private sendFull(conn: Conn) {
    conn.sendJson(this.fullState(conn));
    conn.sendJson(conn.slot >= 0 ? this.publicState(this.players[conn.slot].team) : this.publicState(-2));
  }

  private broadcastFull() {
    for (const c of this.conns) this.sendFull(c);
  }

  status() {
    return {
      humans: this.players.filter((p) => !p.isBot).length,
      bots: this.players.filter((p) => p.isBot).length,
      spectators: this.spectators.size,
      phase: this.phase,
      round: this.roundNum,
      score: this.scores,
      map: this.info.name,
      mapId: this.mapId,
    };
  }
}
