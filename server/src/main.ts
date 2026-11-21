// HTTP API (аккаунты, снаряжение, статус), WebSocket комнаты и раздача собранного клиента.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { decodeCmds, DT, type ClientMsg } from '../../shared/src/index';
import { AccountStore, type Account } from './accounts';
import { Room, type Conn } from './room';

const PORT = Number(process.env.GAME_PORT ?? 8080);
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist/client');
const BOT_LEVEL = process.env.BOT_LEVEL ?? 'medium';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const accounts = new AccountStore(DATA_DIR);
const START_MAPS = ['market', 'wasteland', 'quarter'];
const room = new Room(BOT_LEVEL, Math.max(0, Math.min(100, Number(process.env.MAX_SPECTATORS ?? 20))), process.env.START_MAP ?? START_MAPS[Math.floor(Math.random() * START_MAPS.length)]);

// ---------- Игровой цикл 64 Гц с поправкой на дрейф ----------
let nextTick = performance.now();
const tickMs = DT * 1000;
let lastTickAt = Date.now();
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= nextTick && n < 8) {
    room.step();
    nextTick += tickMs;
    n++;
  }
  if (now - nextTick > 500) nextTick = now; // после долгой паузы не догоняем
  lastTickAt = Date.now();
  setTimeout(loop, Math.max(0, nextTick - performance.now() - 1));
}
loop();

// ---------- HTTP ----------

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '?';
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 16 * 1024) {
        fail(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        ok({});
      }
    });
    req.on('error', fail);
  });
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function publicAccount(a: Account) {
  return { login: a.login, loadout: a.loadout, settings: a.settings, created: a.created };
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
  if (p.includes('..')) return json(res, 400, { error: 'bad path' });
  let file = join(STATIC_DIR, p);
  if (!p || !existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Клиент не собран: выполните npm run build или используйте npm run dev');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  const ip = clientIp(req);
  try {
    if (path === '/healthz') {
      const ok = Date.now() - lastTickAt < 2000;
      return json(res, ok ? 200 : 503, { ok, tick: room.tick, tickMs: room.tickTimeMs });
    }
    if (!path.startsWith('/api/')) return serveStatic(req, res);
    if (req.method === 'GET' && path === '/api/status') return json(res, 200, { ...room.status(), accounts: accounts.count });
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') return json(res, 405, { error: 'method' });
    const body = req.method === 'GET' ? {} : await readBody(req);

    if (path === '/api/register' && req.method === 'POST') {
      const r = await accounts.register(String(body.login ?? ''), String(body.password ?? ''), ip);
      if ('error' in r) return json(res, 400, r);
      return json(res, 200, { token: r.token, recovery: r.recovery, account: publicAccount(r.account) });
    }
    if (path === '/api/login' && req.method === 'POST') {
      const r = await accounts.login(String(body.login ?? ''), String(body.password ?? ''), ip);
      if ('error' in r) return json(res, 401, r);
      return json(res, 200, { token: r.token, account: publicAccount(r.account) });
    }
    if (path === '/api/recover' && req.method === 'POST') {
      const r = await accounts.recover(String(body.login ?? ''), String(body.code ?? ''), String(body.password ?? ''), ip);
      if ('error' in r) return json(res, 400, r);
      return json(res, 200, r);
    }
    if (path === '/api/admin' && req.method === 'POST') {
      if (!ADMIN_SECRET || body.secret !== ADMIN_SECRET) return json(res, 403, { error: 'forbidden' });
      if (body.cmd === 'ban') accounts.ban(String(body.login ?? ''), String(body.reason ?? ''), body.ip ? String(body.ip) : undefined);
      if (body.cmd === 'drain') {
        // после конца текущего матча процесс завершится, Docker перезапустит контейнер
        room.draining = true;
        console.log('drain: комната закроется после окончания матча');
        room.onDrained = () => {
          accounts.flush();
          process.exit(0);
        };
      }
      return json(res, 200, { ok: true });
    }

    // Ниже — только для вошедших
    const token = bearer(req);
    const acc = accounts.byToken(token);
    if (!acc) return json(res, 401, { error: 'Нужно войти' });
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { account: publicAccount(acc) });
    if (path === '/api/logout' && req.method === 'POST') {
      accounts.logout(token);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/logout-all' && req.method === 'POST') {
      accounts.logoutAll(acc.id);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/password' && req.method === 'POST') {
      const err = await accounts.changePassword(acc, String(body.old ?? ''), String(body.password ?? ''));
      return err ? json(res, 400, { error: err }) : json(res, 200, { ok: true });
    }
    if (path === '/api/delete' && req.method === 'POST') {
      const err = await accounts.deleteAccount(acc, String(body.password ?? ''));
      return err ? json(res, 400, { error: err }) : json(res, 200, { ok: true });
    }
    if (path === '/api/loadout' && req.method === 'PUT') {
      accounts.setLoadout(acc, body.loadout);
      return json(res, 200, { loadout: acc.loadout });
    }
    if (path === '/api/settings' && req.method === 'PUT') {
      accounts.setSettings(acc, body.settings);
      return json(res, 200, { settings: acc.settings });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Ошибка сервера' });
  }
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const wsPerIp = new Map<string, number>();
let connIds = 1;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const ip = clientIp(req);
  const origin = req.headers.origin ?? '';
  const host = req.headers.host ?? '';
  const originOk = !origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith('//' + host) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (url.pathname !== '/ws' || !originOk || accounts.isIpBanned(ip) || (wsPerIp.get(ip) ?? 0) >= 4) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, ip));
});

function onSocket(ws: WebSocket, ip: string) {
  wsPerIp.set(ip, (wsPerIp.get(ip) ?? 0) + 1);
  let conn: Conn | null = null;
  let budget = 0;
  let budgetReset = Date.now();
  const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 5000);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    // лимит пакетов: не больше ~200 в секунду
    const now = Date.now();
    if (now - budgetReset > 1000) {
      budget = 0;
      budgetReset = now;
    }
    if (++budget > 200) return;
    if (isBinary) {
      if (!conn) return;
      const buf = data instanceof Buffer ? data : Buffer.concat(data as Buffer[]);
      const cmds = decodeCmds(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      if (cmds) room.onCmds(conn, cmds);
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!conn) {
      if (msg.t !== 'auth') return;
      const acc = accounts.byToken(msg.token);
      if (!acc) {
        ws.send(JSON.stringify({ t: 'kick', msg: 'Сессия истекла, войдите снова' }));
        ws.close(4002, 'auth');
        return;
      }
      clearTimeout(authTimer);
      conn = {
        id: connIds++,
        accountId: acc.id,
        login: acc.login,
        loadout: acc.loadout,
        slot: -1,
        pendingSlot: -1,
        lastChat: -10,
        sendJson: (m) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
        },
        sendBin: (b) => {
          if (ws.readyState === ws.OPEN) ws.send(b, { binary: true });
        },
        buffered: () => ws.bufferedAmount,
        close: (reason) => {
          try {
            ws.close(4003, reason.slice(0, 100));
          } catch {
            /* уже закрыт */
          }
        },
      };
      room.join(conn);
      return;
    }
    switch (msg.t) {
      case 'buy':
        if (conn.slot >= 0 && typeof msg.item === 'string') room.buy(room.players[conn.slot], msg.item);
        break;
      case 'chat':
        if (typeof msg.text === 'string') room.chat(conn, msg.text);
        break;
      case 'vote':
        if (typeof msg.map === 'string') room.vote(conn, msg.map);
        break;
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', c: msg.c }));
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    wsPerIp.set(ip, Math.max(0, (wsPerIp.get(ip) ?? 1) - 1));
    if (conn) room.leave(conn);
  });
  ws.on('error', () => {});
}

server.listen(PORT, () => {
  console.log(`Voxel Tactical Shooter: сервер комнаты на порту ${PORT}, боты: ${BOT_LEVEL}, данные: ${DATA_DIR}`);
});

function shutdown() {
  accounts.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
