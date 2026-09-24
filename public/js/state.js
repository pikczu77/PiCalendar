// Client-side state, REST calls and the live event stream.

export const STATUS = {
  planned: { label: 'Planowane', short: 'Plan', color: 'indigo' },
  doing: { label: 'W trakcie', short: 'W trakcie', color: 'orange' },
  done: { label: 'Gotowe', short: 'Gotowe', color: 'green' },
};
export const STATUS_KEYS = ['planned', 'doing', 'done'];
export const COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow', 'indigo', 'gray'];

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* private mode */ }
  },
};

export const state = {
  boards: [],
  members: [],
  cards: [],
  activity: [],
  online: [],
  meId: storage.get('pical.me'),
  boardId: storage.get('pical.board') || 'all',
  view: storage.get('pical.view') || 'board',
  onlyMine: storage.get('pical.onlyMine') === '1',
  connected: false,
};

export const clientId = uid();

// ---------- subscriptions ----------

const listeners = new Set();
let queued = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Batches notifications into one per frame. */
export function notify(reason = 'data') {
  if (queued) {
    queued.add(reason);
    return;
  }
  queued = new Set([reason]);
  requestAnimationFrame(() => {
    const reasons = queued;
    queued = null;
    for (const fn of listeners) fn(reasons);
  });
}

// ---------- selectors ----------

export const me = () => state.members.find((m) => m.id === state.meId) || null;
export const memberById = (id) => state.members.find((m) => m.id === id) || null;
export const boardById = (id) => state.boards.find((b) => b.id === id) || null;
export const cardById = (id) => state.cards.find((c) => c.id === id) || null;

export function visibleCards() {
  return state.cards.filter((c) => (state.boardId === 'all' || c.boardId === state.boardId)
    && (!state.onlyMine || c.assignees.includes(state.meId)));
}

export function cardsByStatus(status, cards = visibleCards()) {
  return cards.filter((c) => c.status === status).sort((a, b) => a.order - b.order);
}

export function currentBoard() {
  return state.boardId === 'all' ? null : boardById(state.boardId);
}

export function setView(view) {
  state.view = view;
  storage.set('pical.view', view);
  notify('view');
}

export function setBoard(id) {
  state.boardId = id;
  storage.set('pical.board', id);
  notify('board');
}

export function setOnlyMine(value) {
  state.onlyMine = value;
  storage.set('pical.onlyMine', value ? '1' : '0');
  notify('filter');
}

export function setMe(id) {
  state.meId = id;
  storage.set('pical.me', id);
  notify('me');
}

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onError = () => {};
export function setErrorHandler(fn) {
  onError = fn;
}

export async function api(method, path, body) {
  const headers = { 'X-Client-Id': clientId };
  if (state.meId) headers['X-Member-Id'] = state.meId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Brak połączenia z serwerem');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Coś poszło nie tak');
  return data;
}

/**
 * Optional alternative backend (Firebase). When set, writes go there and its
 * realtime listeners keep `state` up to date instead of the Node API + SSE.
 */
let remote = null;
export function setBackend(backend) {
  remote = backend;
}
export const usingRemote = () => Boolean(remote);

/** Runs a Node API mutation; on failure reports it and re-syncs to the server's truth. */
async function mutate(method, path, body) {
  try {
    return await api(method, path, body);
  } catch (err) {
    onError(err);
    loadState().catch(() => {});
    throw err;
  }
}

/** Runs a Firebase write; a rejected write is rolled back by its listeners. */
async function write(promise) {
  try {
    return await promise;
  } catch (err) {
    onError(err);
    throw err;
  }
}

export async function loadState() {
  if (remote) return null;
  const data = await api('GET', '/state');
  state.boards = data.boards;
  state.members = data.members;
  state.cards = data.cards;
  state.activity = data.activity;
  state.online = data.online;
  if (state.boardId !== 'all' && !boardById(state.boardId)) state.boardId = 'all';
  notify('data');
  return data;
}

function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) list.push(item);
  else list[i] = item;
}

function pushActivity(item) {
  if (!item) return;
  const i = state.activity.findIndex((a) => a.id === item.id);
  if (i !== -1) state.activity.splice(i, 1);
  state.activity.unshift(item);
  if (state.activity.length > 100) state.activity.length = 100;
}

function nextOrder(boardId, status) {
  return Math.max(0, ...state.cards.filter((c) => c.boardId === boardId && c.status === status).map((c) => c.order)) + 1;
}

// ---------- mutations (optimistic) ----------

export function createCard(fields) {
  const now = new Date().toISOString();
  const status = fields.status || 'planned';
  const boardId = fields.boardId || state.boards[0]?.id;
  const card = {
    id: uid(),
    boardId,
    title: fields.title,
    notes: fields.notes || '',
    status,
    start: fields.start || null,
    due: fields.due || null,
    color: fields.color || null,
    assignees: fields.assignees || [],
    checklist: fields.checklist || [],
    order: nextOrder(boardId, status),
    createdAt: now,
    updatedAt: now,
    createdBy: state.meId,
    updatedBy: state.meId,
    doneAt: status === 'done' ? now : null,
  };
  if (card.start && card.due && card.start > card.due) card.start = card.due;
  state.cards.push(card);
  notify('data');
  if (remote) return write(remote.createCard(card));
  const { createdAt, updatedAt, createdBy, updatedBy, doneAt, ...payload } = card;
  return mutate('POST', '/cards', payload);
}

export function updateCard(id, patch) {
  const card = cardById(id);
  if (!card) return Promise.resolve();
  const prev = { ...card };
  const now = new Date().toISOString();
  if (patch.status && patch.status !== card.status && !('order' in patch)) {
    patch = { ...patch, order: nextOrder(patch.boardId || card.boardId, patch.status) };
  }
  const derived = { updatedAt: now, updatedBy: state.meId };
  if (patch.status && patch.status !== card.status) derived.doneAt = patch.status === 'done' ? now : null;
  Object.assign(card, patch, derived);
  notify('data');
  if (remote) return write(remote.updateCard(id, { ...patch, ...derived }, prev, card));
  return mutate('PATCH', `/cards/${id}`, patch);
}

export function deleteCard(id) {
  const card = cardById(id);
  state.cards = state.cards.filter((c) => c.id !== id);
  notify('data');
  if (remote) return card ? write(remote.deleteCard(card)) : Promise.resolve();
  return mutate('DELETE', `/cards/${id}`);
}

export async function createBoard(fields) {
  const board = { id: uid(), emoji: '📋', color: 'blue', ...fields, createdAt: new Date().toISOString() };
  state.boards.push(board);
  notify('data');
  if (remote) await write(remote.createBoard(board));
  else await mutate('POST', '/boards', board);
  return board;
}

export function updateBoard(id, patch) {
  const board = boardById(id);
  if (board) Object.assign(board, patch);
  notify('data');
  if (remote) return write(remote.updateBoard(id, patch));
  return mutate('PATCH', `/boards/${id}`, patch);
}

export function deleteBoard(id) {
  const board = boardById(id);
  const cardIds = state.cards.filter((c) => c.boardId === id).map((c) => c.id);
  state.boards = state.boards.filter((b) => b.id !== id);
  state.cards = state.cards.filter((c) => c.boardId !== id);
  if (state.boardId === id) setBoard('all');
  notify('data');
  if (remote) return board ? write(remote.deleteBoard(board, cardIds)) : Promise.resolve();
  return mutate('DELETE', `/boards/${id}`);
}

export async function createMember(fields) {
  let member;
  if (remote) {
    member = { id: uid(), name: fields.name.trim().slice(0, 40), color: fields.color, createdAt: new Date().toISOString() };
    await write(remote.createMember(member));
  } else {
    member = await api('POST', '/members', { id: uid(), ...fields });
  }
  upsert(state.members, member);
  setMe(member.id);
  return member;
}

export function updateMember(id, patch) {
  const member = memberById(id);
  if (member) Object.assign(member, patch);
  notify('data');
  if (remote) return write(remote.updateMember(id, patch));
  return mutate('PATCH', `/members/${id}`, patch);
}

// ---------- live events ----------

let source = null;
let onRemote = () => {};

export function setRemoteHandler(fn) {
  onRemote = fn;
}

function applyEvent(ev) {
  switch (ev.type) {
    case 'presence':
      state.online = ev.online;
      notify('presence');
      return;
    case 'card':
      upsert(state.cards, ev.card);
      break;
    case 'card-deleted':
      state.cards = state.cards.filter((c) => c.id !== ev.id);
      break;
    case 'board':
      upsert(state.boards, ev.board);
      break;
    case 'board-deleted':
      state.boards = state.boards.filter((b) => b.id !== ev.id);
      state.cards = state.cards.filter((c) => c.boardId !== ev.id);
      if (state.boardId === ev.id) setBoard('all');
      break;
    case 'member':
      upsert(state.members, ev.member);
      break;
    default:
      return;
  }
  pushActivity(ev.activity);
  notify(ev.origin === clientId ? 'data' : 'remote');
  if (ev.origin !== clientId) onRemote(ev);
}

export function connect() {
  if (remote) {
    remote.listen(onRemote);
    return;
  }
  if (source) source.close();
  const params = new URLSearchParams({ client: clientId });
  if (state.meId) params.set('member', state.meId);
  source = new EventSource(`api/events?${params}`);
  let first = true;
  source.onopen = () => {
    state.connected = true;
    notify('connection');
    // After a reconnect we may have missed events — resync.
    if (!first) loadState().catch(() => {});
    first = false;
  };
  source.onerror = () => {
    state.connected = false;
    notify('connection');
  };
  source.onmessage = (msg) => {
    try {
      applyEvent(JSON.parse(msg.data));
    } catch (err) {
      console.error(err);
    }
  };
}
