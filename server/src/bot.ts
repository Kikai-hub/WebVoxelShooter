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
  TEAM_CT,
  TEAM_T,
  inRect,
  type UserCmd,
} from '../../shared/src/index';
import type { Player, Room } from './room';

export const BOT_NAMES = ['Алмаз', 'Буран', 'Ветер', 'Гром', 'Дюна', 'Ёрш', 'Жук', 'Зной', 'Искра', 'Кедр', 'Лис', 'Мираж', 'Нерпа', 'Оникс', 'Пума', 'Рысь', 'Сокол', 'Тайга', 'Ураган', 'Филин'];

/** Настройки уровня. По умолчанию — средний. */
export const BOT_LEVELS: Record<string, { react: [number, number]; aimErr: [number, number]; errDecay: number; sway: number; turnRate: number; headChance: number; fov: number; stopToShoot: number }> = {
  easy: { react: [0.5, 0.8], aimErr: [0.12, 0.22], errDecay: 1.4, sway: 0.03, turnRate: 5, headChance: 0.08, fov: 1.1, stopToShoot: 0.6 },
  medium: { react: [0.3, 0.5], aimErr: [0.08, 0.16], errDecay: 2.0, sway: 0.024, turnRate: 8, headChance: 0.15, fov: 1.25, stopToShoot: 0.8 },
  hard: { react: [0.18, 0.3], aimErr: [0.04, 0.08], errDecay: 3.5, sway: 0.007, turnRate: 12, headChance: 0.4, fov: 1.35, stopToShoot: 0.9 },
};

type Goal = { x: number; z: number; kind: 'site' | 'hold' | 'bomb' | 'investigate' | 'plant' | 'defuse' | 'guard'; until: number; lookYaw: number };

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
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
  }

  private buy() {
    const p = this.p;
    const r = this.room;
    const rifle = p.team === TEAM_T || this.rng.next() < 0.85 ? 'vikhr' : 'sokol';
    // Не копит на «идеальный» раунд: покупает лучшее, что может
    if (!p.primary) {
      if (p.money >= 2700 + 650) r.buy(p, rifle === 'sokol' && p.money >= 4750 + 650 ? 'sokol' : 'vikhr');
      else if (p.money >= 1250 + 650) r.buy(p, this.rng.next() < 0.7 ? 'shmel' : 'molot');
      else if (p.money >= 1250 && this.rng.next() < 0.5) r.buy(p, 'shmel');
    }
    if (p.money >= 1000 && p.armor < 100) r.buy(p, 'helmet');
    else if (p.money >= 650 && p.armor < 100) r.buy(p, 'armor');
    if (!p.primary && p.money >= 700 && p.pistol.def.key === 'osa' && this.rng.next() < 0.5) r.buy(p, 'gyurza');
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
      this.setGoal(victim.st.x, victim.st.z, 'investigate', 10, yawTo(victim.st.x - this.p.st.x, victim.st.z - this.p.st.z));
    }
  }

  /** Товарищ сообщил о враге: часть защитников перебрасывается на помощь. */
  callout(x: number, z: number) {
    const p = this.p;
    if (!p.alive || this.target || !this.goal || this.goal.kind !== 'hold') return;
    if (Math.hypot(x - p.st.x, z - p.st.z) < 8 || this.rng.next() > 0.8) return;
    const pt = this.room.nav.randomIn(x - 5, z - 2, x + 5, z + 6, () => this.rng.next()) ?? [x, z];
    this.setGoal(pt[0], pt[1], 'investigate', 25, yawTo(x - pt[0], z - pt[1]));
  }

  // ---------- Мышление ----------

  private setGoal(x: number, z: number, kind: Goal['kind'], dur: number, lookYaw: number) {
    this.goal = { x, z, kind, until: this.room.time + dur, lookYaw };
    this.path = this.room.nav.findPath(this.p.st.x, this.p.st.z, x, z);
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
    if (p.team === TEAM_T) {
      if (b.status === 'planted') {
        const pt = r.nav.randomIn(b.x - 6, b.z - 6, b.x + 6, b.z + 6, rnd) ?? [b.x, b.z];
        this.setGoal(pt[0], pt[1], 'guard', 60, yawTo(info.mid[0] - pt[0], 46 - pt[1]));
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
        const pt = r.nav.randomIn(s.x0, s.z0, s.x1, s.z1, rnd) ?? [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2];
        this.setGoal(pt[0], pt[1], 'site', 90, Math.PI);
      }
    } else {
      if (b.status === 'planted') {
        this.setGoal(b.x, b.z, 'defuse', 60, this.yaw);
        return;
      }
      // роли: 2 на A, 2 на B, 1 в центре
      const roleSite = [0, 1, 0, 1, 2][this.role % 5];
      let pt: [number, number] | null;
      if (roleSite === 2) pt = r.nav.randomIn(info.mid[0] - 4, info.mid[1] - 2, info.mid[0] + 4, info.mid[1] + 4, rnd);
      else {
        const s = info.sites[roleSite];
        pt = r.nav.randomIn(s.x0, s.z0 + 3, s.x1, s.z1, rnd);
      }
      pt ??= [info.mid[0], info.mid[1]];
      // держит угол: смотрит на юг, в сторону подходов нападения
      const look = yawTo((roleSite === 0 ? 10 : roleSite === 1 ? 38 : 24) - pt[0], 15 - pt[1]);
      this.setGoal(pt[0], pt[1], 'hold', 200, look);
    }
  }

  private perceive() {
    const r = this.room;
    const p = this.p;
    const now = r.time;
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
        this.errPitch = Math.sin(a) * err * 0.6;
        this.aimHead = this.rng.next() < this.lv.headChance;
        this.crouchFight = bestD > 15 && this.rng.next() < 0.25;
        this.burstLeft = 0;
      }
      this.targetLastSeen = now;
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
      // услышал — иногда идёт проверить (только если сейчас держит позицию)
      if (this.heard && !this.target && now - this.heard.t < 0.3 && this.goal && (this.goal.kind === 'hold' || this.goal.kind === 'guard') && this.rng.next() < 0.35) {
        const h = this.heard;
        if (Math.hypot(h.x - p.st.x, h.z - p.st.z) < 22) this.setGoal(h.x, h.z, 'investigate', 7, yawTo(h.x - p.st.x, h.z - p.st.z));
      }
    }

    // Оружие
    let slot = this.wantSlot;
    if (slot === SLOT_PRIMARY && !p.primary) slot = SLOT_PISTOL;
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
      const aimY = t.st.y + (this.aimHead ? (t.st.crouch ? 1.12 : 1.62) : t.st.crouch ? 0.85 : 1.15);
      const dx = t.st.x - ex,
        dz = t.st.z - ez,
        dy = aimY - ey;
      const dist = Math.hypot(dx, dz);
      if (this.thinkTick % 10 === 0) {
        this.swayTY = this.rng.range(-1, 1) * this.lv.sway;
        this.swayTP = this.rng.range(-1, 1) * this.lv.sway * 0.8;
      }
      this.swayY += (this.swayTY - this.swayY) * 0.15;
      this.swayP += (this.swayTP - this.swayP) * 0.15;
      const wantYaw = yawTo(dx, dz) + this.errYaw + this.swayY;
      const wantPitch = Math.atan2(dy, dist) + this.errPitch + this.swayP;
      const decay = Math.exp(-DT * this.lv.errDecay);
      this.errYaw *= decay;
      this.errPitch *= decay;
      this.turnToward(wantYaw, wantPitch);
      const aimOff = Math.hypot(angDiff(this.yaw, wantYaw), this.pitch - wantPitch);
      if (now >= this.reactAt && aimOff < 0.06 && now >= this.pauseUntil) {
        const def = (slot === SLOT_PRIMARY ? p.primary?.def : p.pistol.def) ?? p.pistol.def;
        if (def.auto) {
          if (this.burstLeft <= 0) this.burstLeft = dist > 20 ? this.rng.int(3) + 2 : this.rng.int(5) + 3;
          buttons |= BTN_FIRE;
          if (p.simTime >= p.nextFire - DT) {
            this.burstLeft--;
            if (this.burstLeft <= 0) this.pauseUntil = now + this.rng.range(0.2, 0.45);
          }
        } else {
          this.firePressed = !this.firePressed;
          if (this.firePressed) buttons |= BTN_FIRE;
        }
      }
      // обычно останавливается перед стрельбой, иногда двигается вбок
      if (this.rng.next() > this.lv.stopToShoot || now < this.strafeUntil) {
        if (now >= this.strafeUntil) {
          this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
          this.strafeUntil = now + this.rng.range(0.3, 0.7);
        }
        buttons |= this.strafeDir > 0 ? BTN_RIGHT : BTN_LEFT;
      }
      if (this.crouchFight) buttons |= BTN_CROUCH;
    } else if (this.goal) {
      // ---- Передвижение ----
      const g = this.goal;
      const dGoal = Math.hypot(g.x - p.st.x, g.z - p.st.z);
      const arrived = dGoal < 0.8 || (!this.path && dGoal < 2);
      if (!arrived && this.path && this.pathIdx < this.path.length) {
        const [wx, wz] = this.path[this.pathIdx];
        const dx = wx - p.st.x,
          dz = wz - p.st.z;
        if (Math.hypot(dx, dz) < 0.45) this.pathIdx++;
        moveX = dx;
        moveZ = dz;
        wantMove = true;
      } else if (!arrived && !this.path && this.thinkTick % 32 === 0) {
        this.setGoal(g.x, g.z, g.kind, g.until - now, g.lookYaw);
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
            } else this.setGoal(g.x + this.rng.range(-1, 1), g.z + this.rng.range(-1, 1), g.kind, g.until - now, g.lookYaw);
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
