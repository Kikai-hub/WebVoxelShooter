// Бот среднего уровня: видит только по линии обзора, слышит выстрелы,
// реагирует за 0,3–0,5 с, промахивается на дистанции, ходит по навсетке,
// играет по простым планам атаки и защиты. Шлёт те же UserCmd, что и игрок.

import {
  BTN_BACK,
  BTN_CROUCH,
  BTN_FIRE,
  BTN_FWD,
  BTN_JUMP,
  BTN_LEFT,
  BTN_RELOAD,
  BTN_RIGHT,
  BTN_USE,
  DT,
  Rng,
  SLOT_PISTOL,
  SLOT_PRIMARY,
  sprayKick,
  TEAM_CT,
  TEAM_T,
  inRect,
  NADE_FUSE,
  FIRE_FUSE,
  FIRE_RADIUS,
  SLOT_HE,
  stepNade,
  throwNade,
  eyeHeight,
  type UserCmd,
} from '../../shared/src/index';
import type { Player, Room } from './room';

export const BOT_NAMES = ['Алмаз', 'Буран', 'Ветер', 'Гром', 'Дюна', 'Ёрш', 'Жук', 'Зной', 'Искра', 'Кедр', 'Лис', 'Мираж', 'Нерпа', 'Оникс', 'Пума', 'Рысь', 'Сокол', 'Тайга', 'Ураган', 'Филин'];

/** Настройки уровня. По умолчанию — средний. */
export const BOT_LEVELS: Record<string, { react: [number, number]; aimErr: [number, number]; errDecay: number; sway: number; turnRate: number; headChance: number; sprayComp: number; fov: number; stopToShoot: number; pause: [number, number] }> = {
  easy: { react: [0.7, 1.1], aimErr: [0.18, 0.3], errDecay: 0.9, sway: 0.05, turnRate: 4, headChance: 0.02, sprayComp: 0.75, fov: 1.0, stopToShoot: 0.5, pause: [0.5, 0.9] },
  medium: { react: [0.5, 0.8], aimErr: [0.12, 0.22], errDecay: 1.3, sway: 0.035, turnRate: 6, headChance: 0.05, sprayComp: 0.9, fov: 1.15, stopToShoot: 0.75, pause: [0.35, 0.7] },
  hard: { react: [0.25, 0.4], aimErr: [0.06, 0.12], errDecay: 2.6, sway: 0.016, turnRate: 9, headChance: 0.2, sprayComp: 0.95, fov: 1.3, stopToShoot: 0.85, pause: [0.2, 0.45] },
};

/** y — высота ног у цели (крыша, площадка); без неё — нижний уровень. */
type Goal = { x: number; z: number; y?: number; kind: 'site' | 'hold' | 'bomb' | 'investigate' | 'plant' | 'defuse' | 'guard'; until: number; lookYaw: number };
/** Доля ботов, которые занимают второй ярус у точки, если он там есть. */
const PERCH_CHANCE_CT = 0.3;
const PERCH_CHANCE_T = 0.15;

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function spawnCenter(info: { spawns: [Array<[number, number]>, Array<[number, number]>] }, team: number): [number, number] {
  const s = info.spawns[team];
  return [s.reduce((a, p) => a + p[0], 0) / s.length, s.reduce((a, p) => a + p[1], 0) / s.length];
}

function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export class Bot {
  private rng: Rng;
  private lv: (typeof BOT_LEVELS)['medium'];
  private seq = 0;
  private yaw = 0;
  private pitch = 0;
  private target: Player | null = null;
  private targetLastSeen = 0;
  private reactAt = 0;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private goal: Goal | null = null;
  private path: Array<[number, number]> | null = null;
  private pathIdx = 0;
  private stuckAt = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private stuckCount = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  private firePressed = false;
  private strafeDir = 1;
  private strafeUntil = 0;
  private thinkTick = 0;
  private heard: { x: number; z: number; t: number } | null = null;
  private crouchFight = false;
  private role = 0;
  private wantSlot = SLOT_PRIMARY;
  private scanPhase = 0;
  private lastPos: [number, number] = [0, 0];
  private holding = false;
  /** план броска гранаты: переключиться, прицелиться, бросить */
  private throwPlan: { type: number; yaw: number; pitch: number; readyAt: number; giveUpAt: number } | null = null;
  private turnAwayUntil = 0;
  private turnAwayYaw = 0;
  private lastSeenPos: [number, number, number] | null = null;
  private lastSeenAt = -10;
  private heUsedFor = -10;
  private strafing = false;
  private runAndGun = false;
  /** постоянное «дрожание» прицела: у среднего бота не бывает идеальной наводки */
  private swayY = 0;
  private swayP = 0;
  private swayTY = 0;
  private swayTP = 0;

  constructor(
    private room: Room,
    private p: Player,
    level: string,
  ) {
    this.rng = new Rng((p.id + 1) * 7777 + Date.now());
    this.lv = BOT_LEVELS[level] ?? BOT_LEVELS.medium;
  }

  // ---------- События ----------

  onRoundStart() {
    this.target = null;
    this.goal = null;
    this.path = null;
    this.heard = null;
    this.stuckCount = 0;
    this.yaw = this.p.yaw;
    this.pitch = 0;
    const mates = this.room.players.filter((q) => q.team === this.p.team && q.isBot);
    this.role = mates.indexOf(this.p);
    this.buy();
    this.scanPhase = this.rng.next() * 6;
    this.throwPlan = null;
    this.turnAwayUntil = 0;
    this.lastSeenPos = null;
  }

  private buy() {
    const p = this.p;
    const r = this.room;
    const t = p.team === TEAM_T;
    const pick = (...opts: Array<[string, number]>) => {
      // взвешенный случайный выбор
      let s = this.rng.next() * opts.reduce((a, o) => a + o[1], 0);
      for (const [k, w] of opts) if ((s -= w) <= 0) return k;
      return opts[0][0];
    };
    // защита иногда берёт снайперскую; атака — почти всегда автомат
    const sniper = !t && this.rng.next() < 0.15;
    // Не копит на «идеальный» раунд: покупает лучшее, что может
    if (!p.primary) {
      if (sniper && p.money >= 4750 + 650) r.buy(p, p.money >= 5000 + 650 && this.rng.next() < 0.5 ? 'awm' : 'sokol');
      else if (p.money >= 3300 + 650) r.buy(p, t ? pick(['vikhr', 0.65], ['aug', 0.35]) : pick(['m4a1', 0.6], ['aug', 0.25], ['vikhr', 0.15]));
      else if (p.money >= 2900 + 650) r.buy(p, t ? 'vikhr' : pick(['m4a1', 0.8], ['vikhr', 0.2]));
      else if (p.money >= 2700 + 650) r.buy(p, 'vikhr');
      else if (p.money >= 1250 + 650) r.buy(p, t ? pick(['mac10', 0.35], ['shmel', 0.25], ['skorpion', 0.15], ['sawedoff', 0.15], ['molot', 0.1]) : pick(['ump', 0.35], ['shmel', 0.3], ['molot', 0.2], ['mac10', 0.15]));
      else if (p.money >= 1100 && this.rng.next() < 0.5) r.buy(p, t ? pick(['mac10', 0.5], ['skorpion', 0.5]) : pick(['shmel', 0.5], ['ump', 0.5]));
    }
    if (p.money >= 1000 && p.armor < 100) r.buy(p, 'helmet');
    else if (p.money >= 650 && p.armor < 100) r.buy(p, 'armor');
    if (!p.primary && p.money >= 300 && p.pistol.def.key === 'osa' && this.rng.next() < 0.5)
      r.buy(p, p.money >= 800 ? pick(['gyurza', 0.4], ['python', 0.25], ['sw29', 0.2], ['beretta', 0.15]) : p.money >= 600 ? pick(['python', 0.6], ['beretta', 0.4]) : 'beretta');
    // защитник с оружием почти всегда берёт набор сапёра
    if (p.team === TEAM_CT && p.primary && p.money >= 400 && this.rng.next() < 0.7) r.buy(p, 'kit');
    // гранаты — на оставшиеся деньги, не всегда
    if (p.primary) {
      const wish: Array<[string, number]> =
        p.team === TEAM_T
          ? [
              ['smoke', 0.45],
              ['molotov', 0.4],
              ['flash', 0.55],
              ['he', 0.4],
              ['flash', 0.25],
            ]
          : [
              ['incgrenade', 0.35],
              ['he', 0.45],
              ['smoke', 0.45],
              ['flash', 0.4],
            ];
      for (const [k, chance] of wish) if (p.money >= 600 && this.rng.next() < chance) r.buy(p, k);
    }
    this.wantSlot = p.primary ? SLOT_PRIMARY : SLOT_PISTOL;
  }

  onBombPlanted() {
    this.goal = null;
    this.path = null;
  }

  hear(x: number, z: number, radius: number, src: Player) {
    if (src.team === this.p.team || !this.p.alive) return;
    const d = Math.hypot(x - this.p.st.x, z - this.p.st.z);
    if (d > radius) return;
    this.heard = { x, z, t: this.room.time };
  }

  onHurt(from: [number, number, number]) {
    if (!this.target) {
      this.heard = { x: from[0], z: from[2], t: this.room.time };
      // разворачивается на выстрел
      this.yaw += angDiff(this.yaw, yawTo(from[0] - this.p.st.x, from[2] - this.p.st.z)) * 0.5;
    }
  }

  onTeammateDeath(victim: Player) {
    if (victim.team !== this.p.team || victim === this.p || !this.p.alive) return;
    const d = Math.hypot(victim.st.x - this.p.st.x, victim.st.z - this.p.st.z);
    // защитники подтягиваются на сообщение об убийстве
    if (this.p.team === TEAM_CT && d < 25 && !this.target && this.room.phase === 'live' && this.rng.next() < 0.6) {
      this.setGoal(victim.st.x, victim.st.z, 'investigate', 10, yawTo(victim.st.x - this.p.st.x, victim.st.z - this.p.st.z), victim.st.y);
    }
  }

  /** Товарищ сообщил о враге: часть защитников перебрасывается на помощь. */
  callout(x: number, z: number) {
    const p = this.p;
    // дым на место прорыва, чтобы задержать атаку
    const dd = Math.hypot(x - p.st.x, z - p.st.z);
    const r = this.room;
    if (p.alive && p.nades[2] > 0 && !this.target && dd > 8 && dd < 22 && r.time - r.botUtil.ctSmokeAt > 6 && this.rng.next() < 0.5) {
      if (this.planThrow(2, x, z, 4)) r.botUtil.ctSmokeAt = r.time;
    }
    if (!p.alive || this.target || !this.goal || this.goal.kind !== 'hold') return;
    if (Math.hypot(x - p.st.x, z - p.st.z) < 8 || this.rng.next() > 0.8) return;
    const pt = this.room.nav.randomIn(x - 5, z - 2, x + 5, z + 6, () => this.rng.next()) ?? [x, z];
    this.setGoal(pt[0], pt[1], 'investigate', 25, yawTo(x - pt[0], z - pt[1]));
  }

  // ---------- Гранаты ----------

  /** Подбор угла броска: та же физика полёта, что на сервере. Возвращает [угол, промах в метрах]. */
  private aimThrow(type: number, tx: number, tz: number, yaw: number): [number, number] {
    const p = this.p;
    const map = this.room.info.map;
    const ex = p.st.x,
      ey = p.st.y + eyeHeight(p.st),
      ez = p.st.z;
    const steps = type === 2 ? 192 : type === 3 ? Math.round(FIRE_FUSE * 64) : Math.round(NADE_FUSE * 64);
    let best: [number, number] = [0, Infinity];
    let bestScore = Infinity;
    for (let pitch = -0.35; pitch <= 1.2; pitch += 0.06) {
      const st = throwNade(ex, ey, ez, yaw, pitch, 0, 0);
      for (let i = 0; i < steps && !st.resting; i++) {
        const falling = st.vy < 0;
        stepNade(st, map);
        // зажигательная разбивается при первом касании пола
        if (type === 3 && falling && st.vy >= 0) break;
      }
      const err = Math.hypot(st.x - tx, st.z - tz);
      // светошумовая лучше взрывается в воздухе над укрытиями
      const score = type === 1 ? err - Math.min(st.y - p.st.y, 5) * 0.5 : err;
      if (score < bestScore) {
        bestScore = score;
        best = [pitch, err];
      }
    }
    return best;
  }

  /** Запланировать бросок гранаты типа type (0 — осколочная, 1 — светошумовая, 2 — дымовая) в точку. */
  private planThrow(type: number, tx: number, tz: number, maxErr = 3.5): boolean {
    const p = this.p;
    if (this.throwPlan || p.nades[type] <= 0) return false;
    const d = Math.hypot(tx - p.st.x, tz - p.st.z);
    if (d < 5 || d > 30) return false;
    const yaw = yawTo(tx - p.st.x, tz - p.st.z);
    const [pitch, err] = this.aimThrow(type, tx, tz, yaw);
    if (err > maxErr) return false;
    const now = this.room.time;
    // средний бот бросает не идеально
    this.throwPlan = { type, yaw: yaw + this.rng.range(-0.05, 0.05), pitch: pitch + this.rng.range(-0.03, 0.03), readyAt: now + 0.45, giveUpAt: now + 2.5 };
    return true;
  }

  /** Тактика гранат: решается раз в 4 тика. */
  private considerGrenades() {
    const r = this.room;
    const p = this.p;
    const now = r.time;
    if (this.throwPlan || r.phase !== 'live' && r.phase !== 'planted') return;
    if (now < p.blindUntil) return;
    const info = r.info;
    // 1) Осколочная туда, где враг только что скрылся
    if (!this.target && p.nades[0] > 0 && this.lastSeenPos && now - this.lastSeenAt > 0.4 && now - this.lastSeenAt < 3 && this.heUsedFor !== this.lastSeenAt) {
      this.heUsedFor = this.lastSeenAt;
      if (this.rng.next() < 0.5) this.planThrow(0, this.lastSeenPos[0], this.lastSeenPos[2]);
      if (this.throwPlan) return;
    }
    if (this.target) return;
    const g = this.goal;
    if (p.team === TEAM_T && g && (g.kind === 'site' || g.kind === 'plant') && r.bomb.status !== 'planted') {
      // 2) Нападение у входа на точку: дым на подход защиты, вспышка на точку
      const site = r.siteAt(g.x, g.z) >= 0 ? r.siteAt(g.x, g.z) : 0;
      const s = info.sites[site];
      const cx = (s.x0 + s.x1) / 2,
        cz = (s.z0 + s.z1) / 2;
      const d = Math.hypot(cx - p.st.x, cz - p.st.z);
      const util = r.botUtil;
      if (d < 16 && d > 7 && p.nades[3] > 0 && !util.fire[site] && util.smoke[site] && this.rng.next() < 0.5) {
        // молотов в глубину точки — выкурить защитников из укрытий
        if (this.planThrow(3, cx, cz, 3.5)) util.fire[site] = true;
      } else if (d < 17 && d > 7 && p.nades[2] > 0 && !util.smoke[site]) {
        const ct = spawnCenter(info, TEAM_CT);
        const l = Math.hypot(ct[0] - cx, ct[1] - cz) || 1;
        // точка между центром точки и базой защиты
        if (this.planThrow(2, cx + ((ct[0] - cx) / l) * 4, cz + ((ct[1] - cz) / l) * 4, 4)) util.smoke[site] = true;
      } else if (d < 14 && d > 6 && p.nades[1] > 0 && util.flash[site] < 1 && now - util.lastFlash > 1.5) {
        // вспышка ближе к входу — туда смотрят защитники, держащие точку
        const fx = cx + (p.st.x - cx) * 0.35,
          fz = cz + (p.st.z - cz) * 0.35;
        if (this.planThrow(1, fx, fz, 4)) {
          util.flash[site]++;
          util.lastFlash = now;
        }
      }
    } else if (p.team === TEAM_CT && this.heard && now - this.heard.t < 1 && g && (g.kind === 'hold' || g.kind === 'guard' || g.kind === 'investigate')) {
      // 3) Защита слышит врага, но не видит: осколочная или вспышка на подход
      const hd = Math.hypot(this.heard.x - p.st.x, this.heard.z - p.st.z);
      if (hd < 20 && this.rng.next() < 0.3) {
        // зажигательная перекрывает подход надолго — её первой, если есть
        if (p.nades[3] > 0 && hd > 7) this.planThrow(3, this.heard.x, this.heard.z, 3);
        else if (p.nades[0] > 0 && hd > 7) this.planThrow(0, this.heard.x, this.heard.z, 3);
        else if (p.nades[1] > 0) this.planThrow(1, this.heard.x, this.heard.z, 4);
      }
    }
  }

  /** Стоит в огне (или цель пути в огне) — уйти из него на несколько метров и переждать. */
  private escapeFire() {
    const p = this.p;
    const r = this.room;
    if (!r.fires.length) return;
    const f = r.fireAt(p.st.x, p.st.y, p.st.z, 0.6) ?? (this.goal && this.goal.kind !== 'investigate' ? r.fireAt(this.goal.x, this.goal.y ?? p.st.y, this.goal.z, 0.6) : null);
    if (!f) return;
    // точка за краем огня, по направлению от его центра
    let dx = p.st.x - f.x,
      dz = p.st.z - f.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const tx = f.x + dx * (FIRE_RADIUS + 2.5),
      tz = f.z + dz * (FIRE_RADIUS + 2.5);
    const pt = r.nav.randomIn(tx - 1.5, tz - 1.5, tx + 1.5, tz + 1.5, () => this.rng.next()) ?? [tx, tz];
    this.setGoal(pt[0], pt[1], 'investigate', 3, yawTo(f.x - pt[0], f.z - pt[1]));
  }

  /** Союзник бросил вспышку: отвернуться от места взрыва на время. */
  avoidFlash(fx: number, fz: number, now: number) {
    if (this.target) return;
    this.turnAwayUntil = now + 2;
    this.turnAwayYaw = yawTo(this.p.st.x - fx, this.p.st.z - fz);
  }

  /** Выполнение плана броска: стоит, держит гранату, доводит прицел и бросает. */
  private runThrow(now: number): UserCmd | null {
    const t = this.throwPlan;
    if (!t) return null;
    const p = this.p;
    if (now > t.giveUpAt || p.nades[t.type] <= 0 || this.target) {
      this.throwPlan = null;
      return null;
    }
    this.turnToward(t.yaw, t.pitch);
    const aimed = Math.abs(angDiff(this.yaw, t.yaw)) < 0.03 && Math.abs(this.pitch - t.pitch) < 0.03;
    const slot = SLOT_HE + t.type;
    if (aimed && now >= t.readyAt && p.slot === slot && p.simTime >= p.nextFire) {
      this.throwPlan = null;
      if (t.type === 1) {
        // после своей вспышки — отвернуться и предупредить союзников рядом («флешка!»)
        this.turnAwayUntil = now + 1.9;
        this.turnAwayYaw = t.yaw + Math.PI;
        const fx = p.st.x - Math.sin(t.yaw) * 10,
          fz = p.st.z - Math.cos(t.yaw) * 10;
        for (const q of this.room.players) if (q !== p && q.team === p.team && q.alive && Math.hypot(q.st.x - p.st.x, q.st.z - p.st.z) < 25) q.bot?.avoidFlash(fx, fz, now);
      }
      return this.cmd(BTN_FIRE, slot);
    }
    return this.cmd(0, slot);
  }

  // ---------- Мышление ----------

  private setGoal(x: number, z: number, kind: Goal['kind'], dur: number, lookYaw: number, y?: number) {
    this.goal = { x, z, y, kind, until: this.room.time + dur, lookYaw };
    this.path = this.room.nav.findPath(this.p.st.x, this.p.st.z, x, z, this.p.st.y, y);
    this.pathIdx = 0;
    this.stuckAt = this.room.time;
    this.stuckX = this.p.st.x;
    this.stuckZ = this.p.st.z;
  }

  private pickStrategicGoal() {
    const r = this.room;
    const p = this.p;
    const info = r.info;
    const rnd = () => this.rng.next();
    const b = r.bomb;
    // разминка: бомбы нет — бродит по карте (точки, центр, база соперника) и стреляет во встречных
    if (r.warm) {
      const s = info.sites[this.rng.int(2)];
      const z = info.spawnZones[1 - p.team];
      const area = this.rng.int(3);
      const pt =
        area === 0
          ? r.nav.randomIn(s.x0, s.z0, s.x1, s.z1, rnd)
          : area === 1
            ? r.nav.randomIn(info.mid[0] - 6, info.mid[1] - 6, info.mid[0] + 6, info.mid[1] + 6, rnd)
            : r.nav.randomIn(z.x0, z.z0, z.x1, z.z1, rnd);
      const [gx, gz] = pt ?? [info.mid[0], info.mid[1]];
      this.setGoal(gx, gz, 'investigate', 25, yawTo(gx - p.st.x, gz - p.st.z));
      return;
    }
    if (p.team === TEAM_T) {
      if (b.status === 'planted') {
        const pt = r.nav.randomIn(b.x - 6, b.z - 6, b.x + 6, b.z + 6, rnd) ?? [b.x, b.z];
        const ct = spawnCenter(info, TEAM_CT);
        this.setGoal(pt[0], pt[1], 'guard', 60, yawTo(ct[0] - pt[0], ct[1] - pt[1]));
        return;
      }
      if (b.status === 'dropped') {
        // ближайший нападающий идёт за бомбой
        const ts = r.players.filter((q) => q.alive && q.team === TEAM_T && q.isBot);
        ts.sort((a, c) => Math.hypot(a.st.x - b.x, a.st.z - b.z) - Math.hypot(c.st.x - b.x, c.st.z - b.z));
        if (ts[0] === p) {
          this.setGoal(b.x, b.z, 'bomb', 30, this.yaw);
          return;
        }
      }
      const site = r.tPlan < 2 ? r.tPlan : this.role % 2;
      const s = info.sites[site];
      if (p.hasBomb) {
        const pt = r.nav.randomIn(s.x0 + 2, s.z0 + 2, s.x1 - 2, s.z1 - 2, rnd) ?? [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2];
        this.setGoal(pt[0], pt[1], 'plant', 90, this.yaw);
      } else {
        // иногда — на крышу или площадку у точки: прикрывать сверху
        const perch = rnd() < PERCH_CHANCE_T ? r.nav.highIn(s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6, rnd) : null;
        const pt = perch ?? r.nav.randomIn(s.x0, s.z0, s.x1, s.z1, rnd) ?? [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2];
        const ct = spawnCenter(info, TEAM_CT);
        this.setGoal(pt[0], pt[1], 'site', 90, perch ? yawTo(ct[0] - pt[0], ct[1] - pt[1]) : Math.PI, pt[2]);
      }
    } else {
      if (b.status === 'planted') {
        this.setGoal(b.x, b.z, 'defuse', 60, this.yaw);
        return;
      }
      // роли: 2 на A, 2 на B, 1 в центре
      const roleSite = (info.ctRoles ?? [0, 1, 0, 1, 2])[this.role % 5];
      let pt: [number, number, number?] | null;
      if (roleSite === 2) pt = r.nav.coverIn(info.mid[0] - 4, info.mid[1] - 2, info.mid[0] + 4, info.mid[1] + 4, rnd);
      else {
        const s = info.sites[roleSite];
        // часть защитников держит точку с крыши или площадки рядом, если она есть
        pt = rnd() < PERCH_CHANCE_CT ? r.nav.highIn(s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6, rnd) : null;
        pt ??= r.nav.coverIn(s.x0, s.z0 + 3, s.x1, s.z1, rnd);
      }
      pt ??= [info.mid[0], info.mid[1]];
      // держит угол: смотрит на юг, в сторону подходов нападения
      const ts = spawnCenter(info, TEAM_T);
      const look = yawTo(ts[0] - pt[0], ts[1] - pt[1]);
      this.setGoal(pt[0], pt[1], 'hold', 200, look, pt[2]);
    }
  }

  private perceive() {
    const r = this.room;
    const p = this.p;
    const now = r.time;
    // ослеплён вспышкой — никого не видит
    if (now < p.blindUntil) {
      this.target = null;
      return;
    }
    let best: Player | null = null;
    let bestD = Infinity;
    const [ex, , ez] = p.eye();
    for (const q of r.players) {
      if (!q.alive || q.team === p.team) continue;
      const dx = q.st.x - ex,
        dz = q.st.z - ez;
      const d = Math.hypot(dx, dz);
      if (d > 70) continue;
      const inFov = d < 2.5 || Math.abs(angDiff(this.yaw, yawTo(dx, dz))) < this.lv.fov;
      if (!inFov && q !== this.target) continue;
      if (!r.canSee(p, q)) continue;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best) {
      if (best !== this.target) {
        const wasRecent = this.target === best || now - this.targetLastSeen < 0.6;
        this.target = best;
        // кто держит угол и смотрит в нужную сторону, реагирует быстрее и точнее
        const preAimed = this.holding && Math.abs(angDiff(this.yaw, yawTo(best.st.x - ex, best.st.z - ez))) < 0.5;
        const k = preAimed ? 0.55 : 1;
        this.reactAt = wasRecent ? now + 0.1 : now + this.rng.range(this.lv.react[0], this.lv.react[1]) * k;
        const err = this.rng.range(this.lv.aimErr[0], this.lv.aimErr[1]) * k;
        if (p.team === TEAM_CT) for (const q of r.players) if (q !== p && q.team === TEAM_CT) q.bot?.callout(best.st.x, best.st.z);
        const a = this.rng.next() * Math.PI * 2;
        this.errYaw = Math.cos(a) * err;
        this.errPitch = Math.sin(a) * err * 0.3;
        this.aimHead = this.rng.next() < this.lv.headChance;
        this.crouchFight = bestD > 15 && this.rng.next() < 0.25;
        this.burstLeft = 0;
      }
      this.targetLastSeen = now;
      this.lastSeenPos = [best.st.x, best.st.y, best.st.z];
      this.lastSeenAt = now;
    } else if (this.target && (now - this.targetLastSeen > 1.2 || !this.target.alive)) {
      // потерял цель: идёт проверить последнее место
      if (this.target.alive) this.heard = { x: this.target.st.x, z: this.target.st.z, t: now };
      this.target = null;
    }
  }

  think(): UserCmd {
    const r = this.room;
    const p = this.p;
    const now = r.time;
    let buttons = 0;
    if (!p.alive) return this.cmd(0);
    if (++this.thinkTick % 4 === 0) this.perceive();

    // Решения раз в 4 тика (16 в секунду)
    if (this.thinkTick % 4 === 1) {
      const b = r.bomb;
      const needNew =
        !this.goal ||
        now > this.goal.until ||
        (b.status === 'planted' && this.goal.kind !== 'guard' && this.goal.kind !== 'defuse' && this.goal.kind !== 'investigate') ||
        (p.team === TEAM_T && b.status === 'dropped' && this.goal.kind !== 'bomb' && this.thinkTick % 64 === 1) ||
        (this.goal.kind === 'bomb' && b.status !== 'dropped') ||
        (this.goal.kind === 'plant' && !p.hasBomb) ||
        (p.hasBomb && this.goal.kind !== 'plant');
      if (needNew) this.pickStrategicGoal();
      this.escapeFire();
      this.considerGrenades();
      // услышал — иногда идёт проверить (только если сейчас держит позицию)
      if (this.heard && !this.target && now - this.heard.t < 0.3 && this.goal && (this.goal.kind === 'hold' || this.goal.kind === 'guard') && this.rng.next() < 0.35) {
        const h = this.heard;
        if (Math.hypot(h.x - p.st.x, h.z - p.st.z) < 22) this.setGoal(h.x, h.z, 'investigate', 7, yawTo(h.x - p.st.x, h.z - p.st.z));
      }
    }

    const thr = r.phase === 'freeze' ? null : this.runThrow(now);
    if (thr) return thr;
    if (now < this.turnAwayUntil && !this.target) {
      this.turnToward(this.turnAwayYaw, -0.3);
      return this.cmd(0, p.primary ? SLOT_PRIMARY : SLOT_PISTOL);
    }

    // Оружие: основное, если есть (в том числе подобранное с земли)
    let slot = p.primary ? SLOT_PRIMARY : SLOT_PISTOL;
    const wi = slot === SLOT_PRIMARY ? p.primary : p.pistol;
    if (wi && wi.mag === 0 && wi.reserve === 0 && slot === SLOT_PRIMARY) slot = SLOT_PISTOL;
    if (wi && wi.mag < wi.def.mag * 0.3 && !this.target && wi.reserve > 0 && p.reloadEnd === 0) buttons |= BTN_RELOAD;

    let moveX = 0,
      moveZ = 0;
    let wantMove = false;
    const t = this.target;
    if (t && t.alive && r.phase !== 'freeze') {
      // ---- Бой ----
      const [ex, ey, ez] = p.eye();
      const aimY = t.st.y + (this.aimHead ? (t.st.crouch ? 1.12 : 1.62) : t.st.crouch ? 0.75 : 1.02);
      const dx = t.st.x - ex,
        dz = t.st.z - ez,
        dy = aimY - ey;
      const dist = Math.hypot(dx, dz);
      if (this.thinkTick % 10 === 0) {
        // кто стоит на позиции, целится спокойнее
        const steady = this.holding ? 0.6 : 1;
        this.swayTY = this.rng.range(-1, 1) * this.lv.sway * steady;
        this.swayTP = this.rng.range(-1, 1) * this.lv.sway * 0.35 * steady;
      }
      this.swayY += (this.swayTY - this.swayY) * 0.15;
      this.swayP += (this.swayTP - this.swayP) * 0.15;
      // паттерн очереди: бот тянет прицел против отдачи, но лишь частично (сила ботов не растёт)
      const wDef = (slot === SLOT_PRIMARY ? p.primary?.def : p.pistol.def) ?? p.pistol.def;
      const kick = sprayKick(wDef, p.spray.idx);
      // вертикаль гасит почти полностью (иначе подъём сам переводит прицел с корпуса в голову),
      // вбок — хуже: змейка остаётся источником промахов
      const comp = this.lv.sprayComp;
      const wantYaw = yawTo(dx, dz) + this.errYaw + this.swayY + kick[0] * comp * 0.6;
      const wantPitch = Math.atan2(dy, dist) + this.errPitch + this.swayP - kick[1] * comp;
      const decay = Math.exp(-DT * this.lv.errDecay);
      this.errYaw *= decay;
      this.errPitch *= decay;
      this.turnToward(wantYaw, wantPitch);
      const aimOff = Math.hypot(angDiff(this.yaw, wantYaw), this.pitch - wantPitch);
      // стреляет, только когда прицел уже на силуэте (допуск по размеру цели на этой дистанции)
      const tol = Math.max(0.012, Math.atan2(0.3, dist));
      // отрезки боя: чаще стоит и стреляет, иногда стрейфит (и тогда редко стреляет на ходу)
      if (now >= this.strafeUntil) {
        this.strafing = this.rng.next() > this.lv.stopToShoot;
        this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
        this.strafeUntil = now + (this.strafing ? this.rng.range(0.3, 0.7) : this.rng.range(0.7, 1.4));
        this.runAndGun = this.rng.next() < 0.25;
      }
      const speed = Math.hypot(p.st.vx, p.st.vz);
      const def = (slot === SLOT_PRIMARY ? p.primary?.def : p.pistol.def) ?? p.pistol.def;
      const inRange = def.kind !== 'shotgun' || dist < 15;
      const steadyEnough = speed < 1.8 || (this.strafing && this.runAndGun);
      if (now >= this.reactAt && aimOff < tol && now >= this.pauseUntil && inRange && steadyEnough) {
        if (def.auto) {
          if (this.burstLeft <= 0) this.burstLeft = dist > 15 ? this.rng.int(2) + 1 : this.rng.int(3) + 2;
          buttons |= BTN_FIRE;
          if (p.simTime >= p.nextFire - DT) {
            this.burstLeft--;
            if (this.burstLeft <= 0) this.pauseUntil = now + this.rng.range(this.lv.pause[0], this.lv.pause[1]);
          }
        } else {
          this.firePressed = !this.firePressed;
          if (this.firePressed && p.simTime >= p.nextFire - DT) {
            buttons |= BTN_FIRE;
            // одиночные — с паузой, а не с максимальной скорострельностью
            this.pauseUntil = now + this.rng.range(this.lv.pause[0], this.lv.pause[1]) * 0.6;
          }
        }
      }
      if (this.strafing) buttons |= this.strafeDir > 0 ? BTN_RIGHT : BTN_LEFT;
      else if (!inRange) buttons |= BTN_FWD; // с дробовиком сближается
      if (this.crouchFight) buttons |= BTN_CROUCH;
    } else if (this.goal) {
      // ---- Передвижение ----
      const g = this.goal;
      const dGoal = Math.hypot(g.x - p.st.x, g.z - p.st.z);
      // цель на крыше: стоять под ней на земле — ещё не пришёл
      const levelOk = g.y === undefined || Math.abs(g.y - p.st.y) < 1;
      const arrived = levelOk && (dGoal < 0.8 || (!this.path && dGoal < 2));
      if (!arrived && this.path && this.pathIdx < this.path.length) {
        const [wx, wz] = this.path[this.pathIdx];
        const dx = wx - p.st.x,
          dz = wz - p.st.z;
        if (Math.hypot(dx, dz) < 0.45) this.pathIdx++;
        moveX = dx;
        moveZ = dz;
        wantMove = true;
      } else if (!arrived && !this.path && this.thinkTick % 32 === 0) {
        this.setGoal(g.x, g.z, g.kind, g.until - now, g.lookYaw, g.y);
      }
      this.holding = arrived || !wantMove;
      if (arrived || !wantMove) {
        // На месте: держит угол с небольшим осмотром
        this.scanPhase += DT;
        const look = g.lookYaw + Math.sin(this.scanPhase * 0.7) * 0.5;
        this.turnToward(this.heard && now - this.heard.t < 3 ? yawTo(this.heard.x - p.st.x, this.heard.z - p.st.z) : look, 0);
        if (g.kind === 'plant' && p.hasBomb && r.siteAt(p.st.x, p.st.z) >= 0 && r.phase === 'live') buttons |= BTN_USE;
        if (g.kind === 'defuse' && r.bomb.status === 'planted' && r.nearBomb(p)) buttons |= BTN_USE;
        if (g.kind === 'investigate' && arrived) g.until = Math.min(g.until, now + 1.5);
      } else {
        const moveYaw = yawTo(moveX, moveZ);
        // осторожность возле трупов своих
        const nearCorpse = r.players.some((q) => q !== p && !q.alive && q.team === p.team && Math.hypot(q.st.x - p.st.x, q.st.z - p.st.z) < 5);
        const lookYaw = this.heard && now - this.heard.t < 2 ? yawTo(this.heard.x - p.st.x, this.heard.z - p.st.z) : moveYaw;
        this.turnToward(lookYaw, 0);
        // движение относительно текущего взгляда
        const rel = angDiff(this.yaw, moveYaw);
        const f = Math.cos(rel),
          s = -Math.sin(rel);
        if (!nearCorpse || this.thinkTick % 10 < 6) {
          if (f > 0.38) buttons |= BTN_FWD;
          if (f < -0.38) buttons |= BTN_BACK;
          if (s > 0.38) buttons |= BTN_RIGHT;
          if (s < -0.38) buttons |= BTN_LEFT;
        }
        // застрял — прыжок и новый путь
        if (now - this.stuckAt > 1.5) {
          const moved = Math.hypot(p.st.x - this.stuckX, p.st.z - this.stuckZ);
          if (moved < 0.4 && r.phase !== 'freeze') {
            buttons |= BTN_JUMP;
            this.stuckCount++;
            r.stats.stuck++;
            if (this.stuckCount > 2) {
              this.goal = null;
              this.stuckCount = 0;
            } else this.setGoal(g.x + this.rng.range(-1, 1), g.z + this.rng.range(-1, 1), g.kind, g.until - now, g.lookYaw, g.y);
          } else {
            this.stuckAt = now;
            this.stuckX = p.st.x;
            this.stuckZ = p.st.z;
            this.stuckCount = 0;
          }
        }
      }
    }
    this.lastPos = [p.st.x, p.st.z];
    return this.cmd(buttons, slot);
  }

  private turnToward(wantYaw: number, wantPitch: number) {
    const maxStep = this.lv.turnRate * DT;
    const dy = angDiff(this.yaw, wantYaw);
    const dp = wantPitch - this.pitch;
    // плавный доворот: быстро издалека, медленно у цели
    const k = 0.25;
    this.yaw += Math.max(-maxStep, Math.min(maxStep, dy * k + Math.sign(dy) * Math.min(Math.abs(dy), 0.004)));
    this.pitch += Math.max(-maxStep, Math.min(maxStep, dp * k));
  }

  private cmd(buttons: number, slot = this.p.slot): UserCmd {
    this.seq = this.p.lastSeq + 1;
    return { seq: this.seq, buttons, yaw: this.yaw, pitch: this.pitch, slot, viewTick: this.room.tick };
  }
}
