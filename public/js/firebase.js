// Firebase (Firestore) backend: lets the app run from static hosting with no server of our own.
// All data of one team lives under spaces/{spaceId}/…; the long random space id is the shared secret.
import { state, notify, uid } from './state.js';
import { today, addDays } from './dates.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const COLLECTIONS = ['boards', 'cards', 'members', 'activity'];
const ONLINE_MS = 150 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const UPDATE_COALESCE_MS = 5 * 60 * 1000;
export const SPACE_RE = /^[A-Za-z0-9_-]{20,64}$/;

let fs;
let db;
let space;

export async function initFirebase(config) {
  const [{ initializeApp }, firestore] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  fs = firestore;
  const app = initializeApp(config);
  try {
    // Offline cache: the app opens and edits work without signal, syncing later.
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }
  if (config.emulator) {
    // Local development: { emulator: '127.0.0.1:8080' } talks to the Firestore emulator.
    const [host, port] = config.emulator.split(':');
    fs.connectFirestoreEmulator(db, host, Number(port));
  }
}

const col = (name) => fs.collection(db, 'spaces', space, name);
const ref = (name, id) => fs.doc(db, 'spaces', space, name, id);

export function newSpaceId() {
  return uid() + uid(); // 24 url-safe chars, ~144 bits
}

export async function spaceExists(id) {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'spaces', id, 'boards'), fs.limit(1)));
  return !snap.empty;
}

export async function createSpace() {
  const id = newSpaceId();
  const now = new Date().toISOString();
  const t = today();
  const boardId = uid();
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, 'spaces', id, 'boards', boardId), { id: boardId, name: 'Nasz projekt', emoji: '🚀', color: 'blue', createdAt: now });
  const card = (title, status, order, start, due, color, extra = {}) => {
    const c = {
      id: uid(), boardId, title, notes: '', status, start, due, color, assignees: [], checklist: [], order,
      createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, doneAt: status === 'done' ? now : null, ...extra,
    };
    batch.set(fs.doc(db, 'spaces', id, 'cards', c.id), c);
  };
  card('Zebrać pomysły od zespołu', 'done', 1, addDays(t, -6), addDays(t, -3), 'purple');
  card('Zaprojektować makiety', 'doing', 1, addDays(t, -2), addDays(t, 2), 'blue', {
    checklist: [
      { id: uid(), text: 'Ekran główny', done: true },
      { id: uid(), text: 'Kalendarz', done: false },
      { id: uid(), text: 'Ustawienia', done: false },
    ],
  });
  card('Przygotować prezentację', 'planned', 1, addDays(t, 4), addDays(t, 6), 'orange', {
    notes: 'Przytrzymaj kartę i przeciągnij ją do innej kolumny, żeby zmienić jej status.',
  });
  card('Spotkanie podsumowujące', 'planned', 2, null, addDays(t, 9), 'teal');
  await batch.commit();
  return id;
}

/** Opens a space and resolves once every collection has delivered its first snapshot. */
export function openSpace(id) {
  space = id;
  return new Promise((resolve, reject) => {
    const pending = new Set(COLLECTIONS);
    let failed = false;
    const ready = (name) => {
      if (pending.delete(name) && !pending.size) resolve();
    };
    const fail = (err) => {
      console.error(err);
      if (!failed && pending.size) {
        failed = true;
        reject(err);
      }
    };
    const byDate = (a, b) => (a.createdAt < b.createdAt ? -1 : 1);

    fs.onSnapshot(col('boards'), (snap) => {
      state.boards = snap.docs.map((d) => d.data()).sort(byDate);
      if (state.boardId !== 'all' && !state.boards.some((b) => b.id === state.boardId)) state.boardId = 'all';
      ready('boards');
      notify('remote');
    }, fail);
    fs.onSnapshot(col('cards'), (snap) => {
      state.cards = snap.docs.map((d) => d.data());
      ready('cards');
      notify('remote');
    }, fail);
    fs.onSnapshot(col('members'), (snap) => {
      state.members = snap.docs.map((d) => d.data()).sort(byDate);
      updateOnline();
      ready('members');
      notify('remote');
    }, fail);

    let initial = true;
    fs.onSnapshot(fs.query(col('activity'), fs.orderBy('at', 'desc'), fs.limit(100)), (snap) => {
      state.activity = snap.docs.map((d) => d.data());
      if (!initial && !snap.metadata.hasPendingWrites) {
        for (const change of snap.docChanges()) {
          if (change.type === 'added') onRemoteActivity(change.doc.data());
        }
      }
      initial = false;
      ready('activity');
      notify('remote');
    }, fail);
  });
}

// ---------- presence (heartbeat on the member doc) ----------

function updateOnline() {
  const now = Date.now();
  const online = state.members.filter((m) => m.lastSeen && now - Date.parse(m.lastSeen) < ONLINE_MS).map((m) => m.id);
  if (state.meId && !online.includes(state.meId) && !document.hidden) online.push(state.meId);
  state.online = online;
}

let heartbeatTimer = null;
function heartbeat() {
  if (!state.meId || document.hidden || !state.members.some((m) => m.id === state.meId)) return;
  fs.updateDoc(ref('members', state.meId), { lastSeen: new Date().toISOString() }).catch(() => {});
}

let onRemoteActivity = () => {};

function setConnected() {
  state.connected = navigator.onLine;
  notify('connection');
}

// ---------- activity log ----------

function log(entry) {
  const item = { id: uid(), at: new Date().toISOString(), memberId: state.meId || null, cardId: null, boardId: null, ...entry };
  return fs.setDoc(ref('activity', item.id), item);
}

// ---------- backend interface used by state.js ----------

export const firebaseBackend = {
  listen(onRemote) {
    onRemoteActivity = (a) => onRemote({ activity: a });
    clearInterval(heartbeatTimer);
    heartbeat();
    heartbeatTimer = setInterval(() => {
      heartbeat();
      updateOnline();
      notify('presence');
    }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', heartbeat);
    addEventListener('online', setConnected);
    addEventListener('offline', setConnected);
    setConnected();
  },

  async createCard(card) {
    await Promise.all([
      fs.setDoc(ref('cards', card.id), card),
      log({ kind: 'card.create', cardId: card.id, boardId: card.boardId, title: card.title, to: card.status }),
    ]);
  },

  async updateCard(id, patch, prev, card) {
    const writes = [fs.updateDoc(ref('cards', id), patch)];
    if (card.status !== prev.status) {
      writes.push(log({ kind: 'card.move', cardId: id, boardId: card.boardId, title: card.title, from: prev.status, to: card.status }));
    } else if (Object.keys(patch).some((k) => !['order', 'updatedAt', 'updatedBy', 'doneAt'].includes(k))) {
      const last = state.activity[0];
      if (last && last.kind === 'card.update' && last.cardId === id && last.memberId === state.meId
        && Date.now() - Date.parse(last.at) < UPDATE_COALESCE_MS) {
        writes.push(fs.updateDoc(ref('activity', last.id), { at: new Date().toISOString(), title: card.title }));
      } else {
        writes.push(log({ kind: 'card.update', cardId: id, boardId: card.boardId, title: card.title }));
      }
    }
    await Promise.all(writes);
  },

  async deleteCard(card) {
    await Promise.all([
      fs.deleteDoc(ref('cards', card.id)),
      log({ kind: 'card.delete', boardId: card.boardId, title: card.title }),
    ]);
  },

  async createBoard(board) {
    await Promise.all([
      fs.setDoc(ref('boards', board.id), board),
      log({ kind: 'board.create', boardId: board.id, title: board.name }),
    ]);
  },

  updateBoard(id, patch) {
    return fs.updateDoc(ref('boards', id), patch);
  },

  async deleteBoard(board, cardIds) {
    // Firestore batches hold up to 500 writes.
    for (let i = 0; i < cardIds.length || i === 0; i += 450) {
      const batch = fs.writeBatch(db);
      cardIds.slice(i, i + 450).forEach((cid) => batch.delete(ref('cards', cid)));
      if (i === 0) batch.delete(ref('boards', board.id));
      await batch.commit();
    }
    await log({ kind: 'board.delete', title: board.name });
  },

  async createMember(member) {
    await fs.setDoc(ref('members', member.id), { ...member, lastSeen: new Date().toISOString() });
    await log({ kind: 'member.join', memberId: member.id, title: member.name });
  },

  updateMember(id, patch) {
    return fs.updateDoc(ref('members', id), patch);
  },
};
