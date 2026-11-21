// Аккаунты: логин + пароль, без почты. Хранилище — JSON-файл в томе data/.
// Пароли и коды восстановления — только хэши (scrypt из node:crypto),
// токены сессий — хэш SHA-256. Баны по аккаунту и IP.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_LOADOUT, type Loadout } from './room';
import { WEAPON_BY_KEY, SLOT_PRIMARY, SLOT_PISTOL, SKINS } from '../../shared/src/index';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface Settings {
  sens: number;
  fov: number;
  tracers: boolean;
  tracerBright: number;
  blood: 'blood' | 'confetti';
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = { sens: 1, fov: 90, tracers: true, tracerBright: 1, blood: 'blood', volume: 0.7 };

export interface Account {
  id: string;
  login: string;
  loginLower: string;
  pass: string; // salt:hash (hex)
  recovery: string;
  created: number;
  lastLogin: number;
  loadout: Loadout;
  settings: Settings;
  banned?: string;
}

interface Session {
  hash: string;
  accountId: string;
  expires: number;
}

interface Db {
  accounts: Account[];
  sessions: Session[];
  bannedIps: string[];
}

const SESSION_DAYS = 30;
const LOGIN_RE = /^[A-Za-zА-Яа-яЁё0-9_]{3,16}$/;
const BAD_WORDS = ['хуй', 'хуе', 'хуё', 'пизд', 'ебал', 'ебат', 'бляд', 'сука', 'мудак', 'пидор', 'fuck', 'shit', 'cunt', 'nigger', 'faggot', 'admin', 'модератор'];
const COMMON_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwertyui', 'qwerty123', '11111111', '00000000', 'iloveyou', '12341234', '87654321', 'qwertyuiop', 'abc12345', 'йцукенгш', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'passw0rd', 'football', 'baseball', 'superman', 'princess', 'sunshine', '123123123', '11223344', 'asdfghjk', 'monkey12', 'dragon12', 'letmein1']);

export class AccountStore {
  private db: Db = { accounts: [], sessions: [], bannedIps: [] };
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private byLogin = new Map<string, Account>();
  private byId = new Map<string, Account>();
  private sessions = new Map<string, Session>();
  /** ограничения на попытки входа */
  private attemptsIp = new Map<string, { n: number; reset: number }>();
  private attemptsAcc = new Map<string, { n: number; lockUntil: number }>();
  private registrationsIp = new Map<string, { n: number; reset: number }>();

  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'accounts.json');
    if (existsSync(this.file)) {
      try {
        this.db = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch (e) {
        console.error('Не удалось прочитать базу аккаунтов', e);
      }
    }
    const now = Date.now();
    this.db.sessions = this.db.sessions.filter((s) => s.expires > now);
    for (const a of this.db.accounts) {
      a.loadout = sanitizeLoadout(a.loadout);
      a.settings = sanitizeSettings(a.settings);
      this.byLogin.set(a.loginLower, a);
      this.byId.set(a.id, a);
    }
    for (const s of this.db.sessions) this.sessions.set(s.hash, s);
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.db.sessions = [...this.sessions.values()];
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.db));
      renameSync(tmp, this.file);
    }, 200);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.db.sessions = [...this.sessions.values()];
    writeFileSync(this.file, JSON.stringify(this.db));
  }

  validateLogin(login: string): string | null {
    if (!LOGIN_RE.test(login)) return 'Логин: 3–16 символов, буквы, цифры и «_»';
    const low = login.toLowerCase();
    if (BAD_WORDS.some((w) => low.includes(w))) return 'Такой логин нельзя использовать';
    if (low.startsWith('bot')) return 'Логин не может начинаться с «bot»';
    return null;
  }

  validatePassword(pw: string, login: string): string | null {
    if (typeof pw !== 'string' || pw.length < 8) return 'Пароль: минимум 8 символов';
    if (pw.length > 128) return 'Пароль слишком длинный';
    if (COMMON_PASSWORDS.has(pw.toLowerCase()) || pw.toLowerCase() === login.toLowerCase()) return 'Этот пароль слишком простой';
    return null;
  }

  isIpBanned(ip: string): boolean {
    return this.db.bannedIps.includes(ip);
  }

  private rateIp(map: Map<string, { n: number; reset: number }>, ip: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const e = map.get(ip);
    if (!e || e.reset < now) {
      map.set(ip, { n: 1, reset: now + windowMs });
      return true;
    }
    e.n++;
    return e.n <= max;
  }

  async register(login: string, password: string, ip: string): Promise<{ token: string; recovery: string; account: Account } | { error: string }> {
    if (this.isIpBanned(ip)) return { error: 'Доступ запрещён' };
    if (!this.rateIp(this.registrationsIp, ip, 5, 60 * 60 * 1000)) return { error: 'Слишком много регистраций с этого адреса, попробуйте позже' };
    const le = this.validateLogin(login);
    if (le) return { error: le };
    const pe = this.validatePassword(password, login);
    if (pe) return { error: pe };
    if (this.byLogin.has(login.toLowerCase())) return { error: 'Этот логин уже занят' };
    const recovery = makeRecoveryCode();
    const acc: Account = {
      id: randomBytes(8).toString('hex'),
      login,
      loginLower: login.toLowerCase(),
      pass: await hashSecret(password),
      recovery: await hashSecret(recovery),
      created: Date.now(),
      lastLogin: Date.now(),
      loadout: structuredClone(DEFAULT_LOADOUT),
      settings: { ...DEFAULT_SETTINGS },
    };
    this.db.accounts.push(acc);
    this.byLogin.set(acc.loginLower, acc);
    this.byId.set(acc.id, acc);
    const token = this.newSession(acc);
    this.save();
    return { token, recovery, account: acc };
  }

  async login(login: string, password: string, ip: string): Promise<{ token: string; account: Account } | { error: string }> {
    const generic = { error: 'Неверный логин или пароль' };
    if (this.isIpBanned(ip)) return { error: 'Доступ запрещён' };
    if (!this.rateIp(this.attemptsIp, ip, 20, 60 * 1000)) return { error: 'Слишком много попыток, подождите минуту' };
    if (typeof login !== 'string' || typeof password !== 'string') return generic;
    const acc = this.byLogin.get(login.toLowerCase());
    const lock = this.attemptsAcc.get(login.toLowerCase());
    if (lock && lock.lockUntil > Date.now()) return { error: 'Слишком много попыток, подождите минуту' };
    if (!acc) {
      await hashSecret(password); // одинаковое время ответа
      return generic;
    }
    if (!(await verifySecret(password, acc.pass))) {
      const e = lock ?? { n: 0, lockUntil: 0 };
      e.n++;
      if (e.n >= 5) {
        e.lockUntil = Date.now() + 60 * 1000;
        e.n = 0;
      }
      this.attemptsAcc.set(login.toLowerCase(), e);
      return generic;
    }
    if (acc.banned) return { error: 'Аккаунт заблокирован: ' + acc.banned };
    this.attemptsAcc.delete(login.toLowerCase());
    acc.lastLogin = Date.now();
    const token = this.newSession(acc);
    this.save();
    return { token, account: acc };
  }

  async recover(login: string, code: string, newPassword: string, ip: string): Promise<{ token: string; recovery: string } | { error: string }> {
    if (!this.rateIp(this.attemptsIp, ip, 10, 60 * 1000)) return { error: 'Слишком много попыток, подождите минуту' };
    const acc = typeof login === 'string' ? this.byLogin.get(login.toLowerCase()) : undefined;
    if (!acc || typeof code !== 'string' || !(await verifySecret(code.trim().toUpperCase(), acc.recovery))) return { error: 'Неверный логин или код восстановления' };
    const pe = this.validatePassword(newPassword, acc.login);
    if (pe) return { error: pe };
    acc.pass = await hashSecret(newPassword);
    // код одноразовый: выдаём новый
    const recovery = makeRecoveryCode();
    acc.recovery = await hashSecret(recovery);
    this.logoutAll(acc.id);
    const token = this.newSession(acc);
    this.save();
    return { token, recovery };
  }

  async changePassword(acc: Account, oldPw: string, newPw: string): Promise<string | null> {
    if (!(await verifySecret(oldPw, acc.pass))) return 'Старый пароль неверен';
    const pe = this.validatePassword(newPw, acc.login);
    if (pe) return pe;
    acc.pass = await hashSecret(newPw);
    this.save();
    return null;
  }

  async deleteAccount(acc: Account, password: string): Promise<string | null> {
    if (!(await verifySecret(password, acc.pass))) return 'Неверный пароль';
    this.logoutAll(acc.id);
    this.db.accounts = this.db.accounts.filter((a) => a !== acc);
    this.byLogin.delete(acc.loginLower);
    this.byId.delete(acc.id);
    this.save();
    return null;
  }

  private newSession(acc: Account): string {
    const token = randomBytes(32).toString('base64url');
    const s: Session = { hash: sha256(token), accountId: acc.id, expires: Date.now() + SESSION_DAYS * 864e5 };
    this.sessions.set(s.hash, s);
    return token;
  }

  /** Проверка токена; продлевает срок сессии. */
  byToken(token: unknown): Account | null {
    if (typeof token !== 'string' || token.length > 100) return null;
    const s = this.sessions.get(sha256(token));
    if (!s || s.expires < Date.now()) return null;
    const acc = this.byId.get(s.accountId);
    if (!acc || acc.banned) return null;
    const ext = Date.now() + SESSION_DAYS * 864e5;
    if (ext - s.expires > 864e5) {
      s.expires = ext;
      this.save();
    }
    return acc;
  }

  logout(token: string) {
    this.sessions.delete(sha256(token));
    this.save();
  }

  logoutAll(accountId: string) {
    for (const [h, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(h);
    this.save();
  }

  setLoadout(acc: Account, l: unknown) {
    acc.loadout = sanitizeLoadout(l);
    this.save();
  }

  setSettings(acc: Account, s: unknown) {
    acc.settings = sanitizeSettings(s);
    this.save();
  }

  ban(login: string, reason: string, ip?: string) {
    const acc = this.byLogin.get(login.toLowerCase());
    if (acc) {
      acc.banned = reason || 'нарушение правил';
      this.logoutAll(acc.id);
    }
    if (ip && !this.db.bannedIps.includes(ip)) this.db.bannedIps.push(ip);
    this.save();
  }

  get count(): number {
    return this.db.accounts.length;
  }
}

/** Сервер проверяет, что выбранные предметы существуют; иначе — значения по умолчанию. */
export function sanitizeLoadout(l: unknown): Loadout {
  const d = DEFAULT_LOADOUT;
  const o = (l && typeof l === 'object' ? l : {}) as Partial<Loadout>;
  const prim = (k: unknown, def: string) => (typeof k === 'string' && WEAPON_BY_KEY[k]?.slot === SLOT_PRIMARY ? k : def);
  const pist = (k: unknown, def: string) => (typeof k === 'string' && WEAPON_BY_KEY[k]?.slot === SLOT_PISTOL ? k : def);
  const ag = (n: unknown) => (n === 0 || n === 1 ? n : 0);
  return {
    primary: [prim(o.primary?.[0], d.primary[0]), prim(o.primary?.[1], d.primary[1])],
    pistol: [pist(o.pistol?.[0], d.pistol[0]), pist(o.pistol?.[1], d.pistol[1])],
    agent: [ag(o.agent?.[0]), ag(o.agent?.[1])],
    skin: typeof o.skin === 'number' && o.skin >= 0 && o.skin < SKINS.length ? Math.floor(o.skin) : 0,
  };
}

export function sanitizeSettings(s: unknown): Settings {
  const o = (s && typeof s === 'object' ? s : {}) as Partial<Settings>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    sens: num(o.sens, 0.1, 5, DEFAULT_SETTINGS.sens),
    fov: num(o.fov, 60, 110, DEFAULT_SETTINGS.fov),
    tracers: typeof o.tracers === 'boolean' ? o.tracers : true,
    tracerBright: num(o.tracerBright, 0, 2, 1),
    blood: o.blood === 'confetti' ? 'confetti' : 'blood',
    volume: num(o.volume, 0, 1, DEFAULT_SETTINGS.volume),
  };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function hashSecret(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 32, SCRYPT_OPTS);
  return salt.toString('hex') + ':' + h.toString('hex');
}

async function verifySecret(pw: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const h = await scrypt(pw, Buffer.from(saltHex, 'hex'), 32, SCRYPT_OPTS);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === h.length && timingSafeEqual(expected, h);
}

function makeRecoveryCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) s += '-';
    s += abc[b[i] % abc.length];
  }
  return s;
}
