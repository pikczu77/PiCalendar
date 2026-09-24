import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/index.js';

let app;
let base;
let dataDir;

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pical-'));
  app = createApp({ dataDir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /PiCalendar/);
  const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notEqual(traversal.status, 200);
});

test('seeds a board with example cards', async () => {
  const { status, data } = await call('GET', '/api/state');
  assert.equal(status, 200);
  assert.equal(data.boards.length, 1);
  assert.ok(data.cards.length >= 3);
  assert.deepEqual(new Set(data.cards.map((c) => c.status)), new Set(['planned', 'doing', 'done']));
});

test('members, cards and activity', async () => {
  const { data: ania } = await call('POST', '/api/members', { name: '  Ania ', color: 'pink' });
  assert.equal(ania.name, 'Ania');
  const headers = { 'X-Member-Id': ania.id };

  const created = await call('POST', '/api/cards', { title: 'Kupić farbę', due: '2026-10-02', start: '2026-10-05' }, headers);
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'planned');
  assert.equal(created.data.createdBy, ania.id);
  // start after due gets clamped
  assert.equal(created.data.start, '2026-10-02');

  const moved = await call('PATCH', `/api/cards/${created.data.id}`, { status: 'done' }, headers);
  assert.equal(moved.data.status, 'done');
  assert.ok(moved.data.doneAt);

  const { data: state } = await call('GET', '/api/state');
  const move = state.activity.find((a) => a.kind === 'card.move' && a.cardId === created.data.id);
  assert.equal(move.from, 'planned');
  assert.equal(move.to, 'done');
  assert.equal(move.memberId, ania.id);

  const del = await call('DELETE', `/api/cards/${created.data.id}`, undefined, headers);
  assert.equal(del.status, 200);
  assert.equal((await call('PATCH', `/api/cards/${created.data.id}`, { title: 'x' })).status, 404);
});

test('rejects invalid input', async () => {
  assert.equal((await call('POST', '/api/cards', { title: '' })).status, 400);
  assert.equal((await call('POST', '/api/cards', { title: 'x', status: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/cards', { title: 'x', due: '2026-02-30' })).status, 400);
  assert.equal((await call('POST', '/api/members', { name: 'x', color: 'plaid' })).status, 400);
  const res = await fetch(`${base}/api/cards`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"title":"x"}' });
  assert.equal(res.status, 415);
});

test('cannot delete the last board', async () => {
  const { data } = await call('GET', '/api/state');
  assert.equal((await call('DELETE', `/api/boards/${data.boards[0].id}`)).status, 400);
  const { data: board } = await call('POST', '/api/boards', { name: 'Remont' });
  await call('POST', '/api/cards', { title: 'Płytki', boardId: board.id });
  assert.equal((await call('DELETE', `/api/boards/${board.id}`)).status, 200);
  const { data: after } = await call('GET', '/api/state');
  assert.ok(!after.cards.some((c) => c.boardId === board.id));
});

test('broadcasts changes over server-sent events', async () => {
  const events = [];
  const req = http.get(`${base}/api/events?client=abcdefgh`);
  const res = await new Promise((r) => req.on('response', r));
  res.setEncoding('utf8');
  let buf = '';
  const got = new Promise((resolve) => {
    res.on('data', (chunk) => {
      buf += chunk;
      for (const block of buf.split('\n\n').slice(0, -1)) {
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      if (events.some((e) => e.type === 'card')) resolve();
    });
  });
  await call('POST', '/api/cards', { title: 'Na żywo' }, { 'X-Client-Id': 'zzzzzzzz' });
  await got;
  req.destroy();
  const ev = events.find((e) => e.type === 'card');
  assert.equal(ev.card.title, 'Na żywo');
  assert.equal(ev.origin, 'zzzzzzzz');
  assert.equal(ev.activity.kind, 'card.create');
});

test('persists to disk', async () => {
  app.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(saved.cards.some((c) => c.title === 'Na żywo'));
});

test('passcode protects the API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pical-'));
  const locked = createApp({ dataDir: dir, passcode: 'sekret' });
  await new Promise((r) => locked.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${locked.server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/state`)).status, 401);
    const session = await (await fetch(`${url}/api/session`)).json();
    assert.deepEqual(session, { authRequired: true, authed: false });
    const bad = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"passcode":"zle"}' });
    assert.equal(bad.status, 401);
    const good = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"passcode":"sekret"}' });
    const cookie = good.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${url}/api/state`, { headers: { cookie } })).status, 200);
  } finally {
    await locked.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
