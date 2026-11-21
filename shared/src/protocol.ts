// Сетевой протокол. Частые пакеты (команды, снапшоты) — бинарные;
// редкие события (раунд, чат, раны, убийства) — JSON в текстовых кадрах.

export const PKT_CMD = 1;
export const PKT_SNAPSHOT = 2;

export interface UserCmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** запрошенный слот оружия */
  slot: number;
  /** тик, который клиент видел при выстреле (для компенсации задержки) */
  viewTick: number;
}

const CMD_BYTES = 19;

export function encodeCmds(cmds: UserCmd[]): ArrayBuffer {
  const buf = new ArrayBuffer(2 + cmds.length * CMD_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, PKT_CMD);
  v.setUint8(1, cmds.length);
  let o = 2;
  for (const c of cmds) {
    v.setUint32(o, c.seq >>> 0, true);
    v.setUint16(o + 4, c.buttons, true);
    v.setFloat32(o + 6, c.yaw, true);
    v.setFloat32(o + 10, c.pitch, true);
    v.setUint8(o + 14, c.slot);
    v.setFloat32(o + 15, c.viewTick, true);
    o += CMD_BYTES;
  }
  return buf;
}

export function decodeCmds(buf: ArrayBuffer | Uint8Array): UserCmd[] | null {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 2 || v.getUint8(0) !== PKT_CMD) return null;
  const n = v.getUint8(1);
  if (n > 8 || u8.byteLength < 2 + n * CMD_BYTES) return null;
  const out: UserCmd[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const yaw = v.getFloat32(o + 6, true);
    const pitch = v.getFloat32(o + 10, true);
    const viewTick = v.getFloat32(o + 15, true);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(viewTick)) return null;
    out.push({
      seq: v.getUint32(o, true),
      buttons: v.getUint16(o + 4, true),
      yaw,
      pitch,
      slot: v.getUint8(o + 14),
      viewTick,
    });
    o += CMD_BYTES;
  }
  return out;
}

// ---- Снапшот ----

export const SF_ALIVE = 1;
export const SF_CROUCH = 2;
export const SF_ONGROUND = 4;
export const SF_USING = 8;
export const SF_RELOADING = 16;

export interface OwnState {
  present: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flags: number;
  hp: number;
  armor: number;
  weapon: number;
  mag: number;
  reserve: number;
  canMove: boolean;
}

export interface EntState {
  id: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  weapon: number;
}

export interface Snapshot {
  tick: number;
  ackSeq: number;
  own: OwnState;
  ents: EntState[];
}

export function newOwnState(): OwnState {
  return { present: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: 0, hp: 0, armor: 0, weapon: 0, mag: 0, reserve: 0, canMove: false };
}

// Квантование: x,z в [0, 64) м, y в [-4, 28) м — 16 бит (~1 мм)
const QXZ = 65535 / 64;
const QY = 65535 / 32;
const TWO_PI = Math.PI * 2;

export function snapshotSize(entCount: number): number {
  return 1 + 4 + 4 + 1 + 37 + 1 + entCount * 13;
}

export function encodeSnapshot(s: Snapshot, buf: ArrayBuffer): number {
  const v = new DataView(buf);
  v.setUint8(0, PKT_SNAPSHOT);
  v.setUint32(1, s.tick, true);
  v.setUint32(5, s.ackSeq >>> 0, true);
  const own = s.own;
  v.setUint8(9, (own.present ? 1 : 0) | (own.canMove ? 2 : 0));
  let o = 10;
  v.setFloat32(o, own.x, true);
  v.setFloat32(o + 4, own.y, true);
  v.setFloat32(o + 8, own.z, true);
  v.setFloat32(o + 12, own.vx, true);
  v.setFloat32(o + 16, own.vy, true);
  v.setFloat32(o + 20, own.vz, true);
  v.setUint8(o + 24, own.flags);
  v.setUint8(o + 25, Math.max(0, Math.min(255, Math.round(own.hp))));
  v.setUint8(o + 26, Math.max(0, Math.min(255, Math.round(own.armor))));
  v.setUint8(o + 27, own.weapon);
  v.setUint8(o + 28, own.mag);
  v.setUint16(o + 29, own.reserve, true);
  // 6 байт резерва под будущее (гранаты и т.п.)
  o += 37;
  v.setUint8(o, s.ents.length);
  o += 1;
  for (const e of s.ents) {
    v.setUint8(o, e.id);
    v.setUint8(o + 1, e.flags);
    v.setUint16(o + 2, Math.max(0, Math.min(65535, Math.round(e.x * QXZ))), true);
    v.setUint16(o + 4, Math.max(0, Math.min(65535, Math.round((e.y + 4) * QY))), true);
    v.setUint16(o + 6, Math.max(0, Math.min(65535, Math.round(e.z * QXZ))), true);
    let yaw = e.yaw % TWO_PI;
    if (yaw < 0) yaw += TWO_PI;
    v.setUint16(o + 8, Math.round((yaw / TWO_PI) * 65535), true);
    v.setInt16(o + 10, Math.round((e.pitch / (Math.PI / 2)) * 32767), true);
    v.setUint8(o + 12, e.weapon);
    o += 13;
  }
  return o;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  const v = new DataView(buf);
  if (buf.byteLength < 48 || v.getUint8(0) !== PKT_SNAPSHOT) return null;
  const own = newOwnState();
  const f = v.getUint8(9);
  own.present = (f & 1) !== 0;
  own.canMove = (f & 2) !== 0;
  let o = 10;
  own.x = v.getFloat32(o, true);
  own.y = v.getFloat32(o + 4, true);
  own.z = v.getFloat32(o + 8, true);
  own.vx = v.getFloat32(o + 12, true);
  own.vy = v.getFloat32(o + 16, true);
  own.vz = v.getFloat32(o + 20, true);
  own.flags = v.getUint8(o + 24);
  own.hp = v.getUint8(o + 25);
  own.armor = v.getUint8(o + 26);
  own.weapon = v.getUint8(o + 27);
  own.mag = v.getUint8(o + 28);
  own.reserve = v.getUint16(o + 29, true);
  o += 37;
  const n = v.getUint8(o);
  o += 1;
  const ents: EntState[] = [];
  for (let i = 0; i < n; i++) {
    ents.push({
      id: v.getUint8(o),
      flags: v.getUint8(o + 1),
      x: v.getUint16(o + 2, true) / QXZ,
      y: v.getUint16(o + 4, true) / QY - 4,
      z: v.getUint16(o + 6, true) / QXZ,
      yaw: (v.getUint16(o + 8, true) / 65535) * TWO_PI,
      pitch: (v.getInt16(o + 10, true) / 32767) * (Math.PI / 2),
      weapon: v.getUint8(o + 12),
    });
    o += 13;
  }
  return { tick: v.getUint32(1, true), ackSeq: v.getUint32(5, true), own, ents };
}

// ---- JSON-сообщения ----

export type BombStatus = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'none';
export type Phase = 'freeze' | 'live' | 'planted' | 'roundEnd' | 'matchEnd' | 'vote';

export interface PublicPlayer {
  i: number; // слот
  n: string; // ник
  t: number; // команда
  b: boolean; // бот
  a: boolean; // жив
  k: number;
  d: number;
  hp: number;
  m: number; // деньги (только своей команде, иначе -1)
  w: number; // оружие в руках
  ag: number; // вариант агента
  sk: number; // раскраска
  c: boolean; // подключён (для людей)
  bomb: boolean;
  kit: boolean; // набор сапёра (видят свои)
}

export interface RoomState {
  t: 'st';
  ph: Phase;
  tl: number; // осталось секунд в фазе
  rn: number; // номер раунда
  sc: [number, number]; // счёт по сторонам T, CT
  bomb: { s: BombStatus; c: number; p: [number, number, number] | null; site: number };
  pl: PublicPlayer[];
  spec: number;
  map: string;
  half: boolean;
  /** голоса за карты во время голосования */
  votes: Record<string, number>;
  /** оружие на земле: id, оружие, позиция */
  drops: Array<{ i: number; w: number; x: number; y: number; z: number; r: number }>;
}

/** События, которые сервер рассылает пачкой раз в тик. */
export type GameEvent =
  | { e: 'shot'; s: number; a: [number, number, number]; b: [number, number, number]; h: 0 | 1 | 2 } // h: 0 мимо, 1 карта, 2 тело
  | { e: 'wound'; v: number; p: number; x: number; y: number; z: number; r: number; x2: 0 | 1 }
  | { e: 'kill'; k: number; v: number; w: number; hs: boolean; ex: boolean; d: [number, number, number]; p: number; at: [number, number, number, number] }
  | { e: 'hurt'; v: number; from: [number, number, number]; dmg: number }
  | { e: 'plant'; p: [number, number, number]; site: number }
  | { e: 'defuse' }
  | { e: 'explode'; p: [number, number, number] }
  | { e: 'roundStart'; rn: number }
  | { e: 'roundEnd'; w: number; why: string }
  | { e: 'matchEnd'; w: number }
  | { e: 'half' }
  | { e: 'nade'; id: number; s: number; type: number; tick: number; p: [number, number, number]; v: [number, number, number] }
  | { e: 'boom'; id: number; type: number; p: [number, number, number] }
  | { e: 'flash'; v: number; dur: number }
  | { e: 'pickup'; s: number; w: number }
  | { e: 'chip'; c: number[] }
  | { e: 'vote' }
  | { e: 'mapChosen'; map: string; votes: number }
  | { e: 'chat'; n: string; t: number; text: string; dead: boolean }
  | { e: 'info'; text: string }
  | { e: 'step'; s: number }
  | { e: 'reload'; s: number };

export interface FullState {
  t: 'full';
  you: number; // слот или -1 для наблюдателя
  tick: number;
  map: string;
  corpses: Array<{ i: number; x: number; y: number; z: number; yaw: number; ex: boolean }>;
  wounds: Array<{ i: number; ops: number[] }>; // плоский массив p,x,y,z,r,x2
  tracers: boolean;
  smokes: Array<{ x: number; y: number; z: number; left: number }>;
  /** сколы стен за раунд: по 10 чисел на операцию */
  chips: number[];
}

export type ServerMsg =
  | RoomState
  | FullState
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'me'; id: number; team: number; money: number; spectator: boolean; queue: number; pri: number; pis: number; nades: [number, number, number]; kit: boolean }
  | { t: 'err'; msg: string }
  | { t: 'kick'; msg: string }
  | { t: 'pong'; c: number };

export type ClientMsg =
  | { t: 'auth'; token: string }
  | { t: 'buy'; item: string }
  | { t: 'chat'; text: string }
  | { t: 'ping'; c: number }
  | { t: 'vote'; map: string };
