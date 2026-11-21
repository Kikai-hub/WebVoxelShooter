// HTTP API аккаунтов. Токен хранится в хранилище страницы (localStorage).
import type { Binds } from '../../shared/src/index';

export interface Loadout {
  primary: [string, string];
  pistol: [string, string];
  agent: [number, number];
  skin: number;
}
export interface Settings {
  sens: number;
  fov: number;
  tracers: boolean;
  tracerBright: number;
  blood: 'blood' | 'confetti';
  volume: number;
  binds: Binds;
}
/** Статистика игрока за всё время (как на сервере, server/src/accounts.ts). */
export interface PlayerStats {
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  shots: number;
  hits: number;
  mvps: number;
  rounds: number;
  roundsWon: number;
  matches: number;
  matchesWon: number;
  playSeconds: number;
  weapons: Record<string, number>;
}
export interface AccountInfo {
  login: string;
  loadout: Loadout;
  settings: Settings;
  created: number;
}

const KEY = 'vts_token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function setToken(t: string) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* приватный режим */
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* пусто */
  }
  if (!res.ok) throw new ApiError(data.error ?? 'Ошибка сети (' + res.status + ')', res.status);
  return data as T;
}

export const api = {
  register: (login: string, password: string) => call<{ token: string; recovery: string; account: AccountInfo }>('POST', 'register', { login, password }),
  login: (login: string, password: string) => call<{ token: string; account: AccountInfo }>('POST', 'login', { login, password }),
  recover: (login: string, code: string, password: string) => call<{ token: string; recovery: string }>('POST', 'recover', { login, code, password }),
  me: () => call<{ account: AccountInfo }>('GET', 'me'),
  logout: () => call('POST', 'logout', {}),
  logoutAll: () => call('POST', 'logout-all', {}),
  changePassword: (old: string, password: string) => call('POST', 'password', { old, password }),
  deleteAccount: (password: string) => call('POST', 'delete', { password }),
  saveLoadout: (loadout: Loadout) => call<{ loadout: Loadout }>('PUT', 'loadout', { loadout }),
  saveSettings: (settings: Settings) => call<{ settings: Settings }>('PUT', 'settings', { settings }),
  stats: () => call<{ stats: PlayerStats }>('GET', 'stats'),
  news: () =>call<{ version: { commit: string; date: string }; news: Array<{ date: string; title: string; items: string[] }> }>('GET', 'news'),
  status: () =>call<{ humans: number; bots: number; spectators: number; phase: string; round: number; score: [number, number]; map: string; mapId: string }>('GET', 'status'),
};
