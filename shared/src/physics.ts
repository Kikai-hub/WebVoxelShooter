// Движение игрока: один и тот же код на сервере (авторитет) и в клиенте (предсказание).

import {
  AIR_ACCEL,
  BTN_BACK,
  BTN_CROUCH,
  BTN_FWD,
  BTN_JUMP,
  BTN_LEFT,
  BTN_RIGHT,
  BTN_USE,
  CROUCH_EYE_HEIGHT,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  DT,
  EYE_HEIGHT,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RUN_SPEED,
} from './constants';
import { VOXEL, VoxelMap } from './map';

export interface PState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouch: boolean;
}

export function newPState(x = 0, y = 0.5, z = 0): PState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouch: false };
}

export function copyPState(dst: PState, src: PState): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.onGround = src.onGround;
  dst.crouch = src.crouch;
}

export function eyeHeight(s: { crouch: boolean }): number {
  return s.crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
}

export function boxCollides(map: VoxelMap, x: number, y: number, z: number, h: number): boolean {
  const R = PLAYER_RADIUS;
  const x0 = Math.floor((x - R) / VOXEL),
    x1 = Math.floor((x + R - 1e-6) / VOXEL);
  const y0 = Math.floor(y / VOXEL),
    y1 = Math.floor((y + h - 1e-6) / VOXEL);
  const z0 = Math.floor((z - R) / VOXEL),
    z1 = Math.floor((z + R - 1e-6) / VOXEL);
  for (let yy = y0; yy <= y1; yy++)
    for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (map.get(xx, yy, zz) !== 0) return true;
  return false;
}

const EPS = 1e-5;

/**
 * Один шаг симуляции движения (1/64 с).
 * canMove=false во время заморозки: можно только смотреть.
 * Удержание «использовать» на земле останавливает игрока (закладка и обезвреживание).
 */
export function stepPlayer(s: PState, buttons: number, yaw: number, map: VoxelMap, canMove: boolean, speedMul = 1): void {
  let fwd = (buttons & BTN_FWD ? 1 : 0) - (buttons & BTN_BACK ? 1 : 0);
  let strafe = (buttons & BTN_RIGHT ? 1 : 0) - (buttons & BTN_LEFT ? 1 : 0);
  if (!canMove || (buttons & BTN_USE && s.onGround)) {
    fwd = 0;
    strafe = 0;
  }

  // Присед
  if (buttons & BTN_CROUCH) s.crouch = true;
  else if (s.crouch && !boxCollides(map, s.x, s.y, s.z, PLAYER_HEIGHT)) s.crouch = false;
  const h = s.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  const maxSpeed = (s.crouch ? CROUCH_SPEED : RUN_SPEED) * speedMul;

  const sy = Math.sin(yaw),
    cy = Math.cos(yaw);
  let wx = -sy * fwd + cy * strafe;
  let wz = -cy * fwd - sy * strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }

  if (s.onGround) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, 1.5) * FRICTION * DT;
      const ns = Math.max(sp - drop, 0) / sp;
      s.vx *= ns;
      s.vz *= ns;
    }
  }
  if (wl > 0) {
    const cur = s.vx * wx + s.vz * wz;
    const add = maxSpeed - cur;
    if (add > 0) {
      const acc = Math.min((s.onGround ? GROUND_ACCEL : AIR_ACCEL) * maxSpeed * DT, add);
      s.vx += acc * wx;
      s.vz += acc * wz;
    }
  }
  // во время закладки/обезвреживания (E на земле) прыгать нельзя
  if (canMove && buttons & BTN_JUMP && s.onGround && !s.crouch && !(buttons & BTN_USE)) {
    s.vy = JUMP_VELOCITY;
    s.onGround = false;
  }
  s.vy = Math.max(s.vy - GRAVITY * DT, -MAX_FALL_SPEED);

  const R = PLAYER_RADIUS;
  // Подъём на ступеньку в один блок (0,5 м), если над ней есть место
  const stepUp = (): boolean => {
    if (!s.onGround) return false;
    const ny = (Math.floor(s.y / VOXEL + 1e-4) + 1) * VOXEL + EPS;
    if (ny - s.y > VOXEL + 0.01 || boxCollides(map, s.x, ny, s.z, h)) return false;
    s.y = ny;
    return true;
  };
  // Ось X
  s.x += s.vx * DT;
  if (boxCollides(map, s.x, s.y, s.z, h) && !stepUp()) {
    if (s.vx > 0) s.x = Math.floor((s.x + R) / VOXEL) * VOXEL - R - EPS;
    else s.x = (Math.floor((s.x - R) / VOXEL) + 1) * VOXEL + R + EPS;
    s.vx = 0;
  }
  // Ось Z
  s.z += s.vz * DT;
  if (boxCollides(map, s.x, s.y, s.z, h) && !stepUp()) {
    if (s.vz > 0) s.z = Math.floor((s.z + R) / VOXEL) * VOXEL - R - EPS;
    else s.z = (Math.floor((s.z - R) / VOXEL) + 1) * VOXEL + R + EPS;
    s.vz = 0;
  }
  // Ось Y
  s.y += s.vy * DT;
  if (boxCollides(map, s.x, s.y, s.z, h)) {
    if (s.vy <= 0) {
      s.y = (Math.floor(s.y / VOXEL) + 1) * VOXEL + EPS;
      s.onGround = true;
    } else {
      s.y = Math.floor((s.y + h) / VOXEL) * VOXEL - h - EPS;
    }
    s.vy = 0;
  } else {
    s.onGround = false;
  }
}
