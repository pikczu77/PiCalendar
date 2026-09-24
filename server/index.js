import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, HttpError } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_BODY = 256 * 1024;
const COOKIE = 'pical_session';

function loadSecret(dataDir) {
  const file = path.join(dataDir, 'secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'Oczekiwano application/json'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Za duże żądanie'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch {
        reject(new HttpError(400, 'Niepoprawny JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  passcode = '',
} = {}) {
  const store = new Store(path.join(dataDir, 'db.json'));
  const token = passcode
    ? crypto.createHmac('sha256', loadSecret(dataDir)).update(`pical:${passcode}`).digest('hex')
    : null;

  /** @type {Set<{res: http.ServerResponse, memberId: string|null, clientId: string|null}>} */
  const clients = new Set();

  const isAuthed = (req) => !token || safeEqual(parseCookies(req.headers.cookie)[COOKIE] || '', token);

  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.res.write(payload);
  }

  function online() {
    return [...new Set([...clients].map((c) => c.memberId).filter(Boolean))];
  }

  function broadcastPresence() {
    broadcast({ type: 'presence', online: online() });
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) client.res.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  function openEvents(req, res, url) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const memberId = url.searchParams.get('member');
    const client = {
      res,
      memberId: memberId && store.member(memberId) ? memberId : null,
      clientId: url.searchParams.get('client'),
    };
    clients.add(client);
    res.write(`data: ${JSON.stringify({ type: 'presence', online: online() })}\n\n`);
    broadcastPresence();
    req.on('close', () => {
      clients.delete(client);
      broadcastPresence();
    });
  }

  async function handleApi(req, res, url) {
    const { method } = req;
    const route = url.pathname.slice('/api'.length) || '/';

    if (route === '/session' && method === 'GET') {
      return sendJson(res, 200, { authRequired: Boolean(token), authed: isAuthed(req) });
    }

    if (route === '/login' && method === 'POST') {
      const body = await readJson(req);
      if (!token) return sendJson(res, 200, { ok: true });
      if (typeof body.passcode !== 'string' || !safeEqual(body.passcode, passcode)) {
        await new Promise((r) => setTimeout(r, 400));
        throw new HttpError(401, 'Niepoprawny kod dostępu');
      }
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`);
      return sendJson(res, 200, { ok: true });
    }

    if (!isAuthed(req)) throw new HttpError(401, 'Wymagany kod dostępu');

    if (route === '/events' && method === 'GET') return openEvents(req, res, url);
    if (route === '/state' && method === 'GET') {
      return sendJson(res, 200, { ...store.snapshot(), online: online() });
    }

    const memberId = req.headers['x-member-id'] || null;
    const origin = req.headers['x-client-id'] || null;
    const emit = (event) => broadcast({ ...event, by: store.actor(memberId), origin });

    let m;
    if (route === '/members' && method === 'POST') {
      const { member, activity } = store.createMember(await readJson(req));
      emit({ type: 'member', member, activity });
      return sendJson(res, 201, member);
    }
    if ((m = route.match(/^\/members\/([\w-]+)$/)) && method === 'PATCH') {
      const { member } = store.updateMember(m[1], await readJson(req));
      emit({ type: 'member', member });
      return sendJson(res, 200, member);
    }

    if (route === '/boards' && method === 'POST') {
      const { board, activity } = store.createBoard(await readJson(req), memberId);
      emit({ type: 'board', board, activity });
      return sendJson(res, 201, board);
    }
    if ((m = route.match(/^\/boards\/([\w-]+)$/))) {
      if (method === 'PATCH') {
        const { board } = store.updateBoard(m[1], await readJson(req));
        emit({ type: 'board', board });
        return sendJson(res, 200, board);
      }
      if (method === 'DELETE') {
        const result = store.deleteBoard(m[1], memberId);
        emit({ type: 'board-deleted', ...result });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (route === '/cards' && method === 'POST') {
      const { card, activity } = store.createCard(await readJson(req), memberId);
      emit({ type: 'card', card, activity });
      return sendJson(res, 201, card);
    }
    if ((m = route.match(/^\/cards\/([\w-]+)$/))) {
      if (method === 'PATCH') {
        const { card, activity } = store.updateCard(m[1], await readJson(req), memberId);
        emit({ type: 'card', card, activity });
        return sendJson(res, 200, card);
      }
      if (method === 'DELETE') {
        const result = store.deleteCard(m[1], memberId);
        emit({ type: 'card-deleted', ...result });
        return sendJson(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, 'Nie znaleziono');
  }

  function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, `.${rel}`);
    if (!file.startsWith(publicDir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nie znaleziono');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url);
      } else {
        throw new HttpError(405, 'Metoda niedozwolona');
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Błąd serwera' : err.message });
      else res.end();
    }
  });

  server.on('close', () => {
    clearInterval(heartbeat);
    store.flush();
  });

  function close() {
    for (const client of clients) client.res.end();
    clients.clear();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, store, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const app = createApp({
    dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : undefined,
    passcode: process.env.PICAL_PASSCODE || '',
  });
  app.server.listen(port, host, () => {
    console.log(`PiCalendar działa na http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (process.env.PICAL_PASSCODE) console.log('Dostęp chroniony kodem (PICAL_PASSCODE).');
  });
  const shutdown = () => {
    app.store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
