import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STATUSES = ['planned', 'doing', 'done'];
export const COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow', 'indigo', 'gray'];

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ACTIVITY = 300;
const UPDATE_COALESCE_MS = 5 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const notFound = (what) => new HttpError(404, `${what} nie istnieje`);

export function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

function cleanText(value, max, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw bad(`${field}: oczekiwano tekstu`);
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw bad(`${field}: niepoprawna data`);
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw bad(`${field}: niepoprawna data`);
  }
  return value;
}

function cleanColor(value, field, allowNull = true) {
  if ((value === null || value === undefined || value === '') && allowNull) return null;
  if (!COLORS.includes(value)) throw bad(`${field}: nieznany kolor`);
  return value;
}

function cleanClientId(value) {
  if (value === undefined || value === null) return newId();
  if (typeof value !== 'string' || !ID_RE.test(value)) throw bad('id: niepoprawny identyfikator');
  return value;
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function seed() {
  const now = new Date().toISOString();
  const today = localToday();
  const boardId = newId();
  const card = (title, status, order, start, due, color, extra = {}) => ({
    id: newId(),
    boardId,
    title,
    notes: '',
    status,
    start,
    due,
    color,
    assignees: [],
    checklist: [],
    order,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    doneAt: status === 'done' ? now : null,
    ...extra,
  });
  return {
    version: 1,
    boards: [{ id: boardId, name: 'Nasz projekt', emoji: '🚀', color: 'blue', createdAt: now }],
    members: [],
    cards: [
      card('Zebrać pomysły od zespołu', 'done', 1, shiftDate(today, -6), shiftDate(today, -3), 'purple'),
      card('Zaprojektować makiety', 'doing', 1, shiftDate(today, -2), shiftDate(today, 2), 'blue', {
        checklist: [
          { id: newId(), text: 'Ekran główny', done: true },
          { id: newId(), text: 'Kalendarz', done: false },
          { id: newId(), text: 'Ustawienia', done: false },
        ],
      }),
      card('Przygotować prezentację', 'planned', 1, shiftDate(today, 4), shiftDate(today, 6), 'orange', {
        notes: 'Przytrzymaj kartę i przeciągnij ją do innej kolumny, żeby zmienić jej status.',
      }),
      card('Spotkanie podsumowujące', 'planned', 2, null, shiftDate(today, 9), 'teal'),
    ],
    activity: [],
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.saveTimer = null;
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw);
      for (const key of ['boards', 'members', 'cards', 'activity']) {
        if (!Array.isArray(data[key])) data[key] = [];
      }
      return data;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep a copy of the unreadable file so nothing is silently lost.
        const backup = `${this.file}.broken-${Date.now()}`;
        try { fs.copyFileSync(this.file, backup); } catch { /* ignore */ }
        console.error(`Nie udało się wczytać ${this.file} (kopia: ${backup}):`, err.message);
      }
      const data = seed();
      this.data = data;
      this.writeNow();
      return data;
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), 150);
  }

  writeNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  flush() {
    if (this.saveTimer) this.writeNow();
  }

  snapshot() {
    const { boards, members, cards, activity } = this.data;
    return { boards, members, cards, activity: activity.slice(0, 100) };
  }

  // ---------- helpers ----------

  board(id) {
    return this.data.boards.find((b) => b.id === id);
  }

  card(id) {
    return this.data.cards.find((c) => c.id === id);
  }

  member(id) {
    return this.data.members.find((m) => m.id === id);
  }

  actor(memberId) {
    return memberId && this.member(memberId) ? memberId : null;
  }

  nextOrder(boardId, status) {
    let max = 0;
    for (const c of this.data.cards) {
      if (c.boardId === boardId && c.status === status && c.order > max) max = c.order;
    }
    return max + 1;
  }

  log(entry) {
    const item = { id: newId(), at: new Date().toISOString(), ...entry };
    this.data.activity.unshift(item);
    if (this.data.activity.length > MAX_ACTIVITY) this.data.activity.length = MAX_ACTIVITY;
    return item;
  }

  // ---------- members ----------

  createMember(input) {
    const name = cleanText(input.name, 40, 'name');
    if (!name) throw bad('Podaj imię');
    const member = {
      id: cleanClientId(input.id),
      name,
      color: cleanColor(input.color ?? 'blue', 'color', false),
      createdAt: new Date().toISOString(),
    };
    if (this.member(member.id)) throw new HttpError(409, 'Taki użytkownik już istnieje');
    this.data.members.push(member);
    const activity = this.log({ kind: 'member.join', memberId: member.id, title: member.name });
    this.scheduleSave();
    return { member, activity };
  }

  updateMember(id, input) {
    const member = this.member(id);
    if (!member) throw notFound('Użytkownik');
    if ('name' in input) {
      const name = cleanText(input.name, 40, 'name');
      if (!name) throw bad('Podaj imię');
      member.name = name;
    }
    if ('color' in input) member.color = cleanColor(input.color, 'color', false);
    this.scheduleSave();
    return { member };
  }

  // ---------- boards ----------

  createBoard(input, memberId) {
    const name = cleanText(input.name, 60, 'name');
    if (!name) throw bad('Podaj nazwę tablicy');
    const board = {
      id: cleanClientId(input.id),
      name,
      emoji: cleanText(input.emoji, 8, 'emoji') || '📋',
      color: cleanColor(input.color ?? 'blue', 'color', false),
      createdAt: new Date().toISOString(),
    };
    if (this.board(board.id)) throw new HttpError(409, 'Taka tablica już istnieje');
    this.data.boards.push(board);
    const activity = this.log({ kind: 'board.create', memberId: this.actor(memberId), boardId: board.id, title: board.name });
    this.scheduleSave();
    return { board, activity };
  }

  updateBoard(id, input) {
    const board = this.board(id);
    if (!board) throw notFound('Tablica');
    if ('name' in input) {
      const name = cleanText(input.name, 60, 'name');
      if (!name) throw bad('Podaj nazwę tablicy');
      board.name = name;
    }
    if ('emoji' in input) board.emoji = cleanText(input.emoji, 8, 'emoji') || '📋';
    if ('color' in input) board.color = cleanColor(input.color, 'color', false);
    this.scheduleSave();
    return { board };
  }

  deleteBoard(id, memberId) {
    const board = this.board(id);
    if (!board) throw notFound('Tablica');
    if (this.data.boards.length <= 1) throw bad('Nie można usunąć ostatniej tablicy');
    this.data.boards = this.data.boards.filter((b) => b.id !== id);
    const removedCards = this.data.cards.filter((c) => c.boardId === id).map((c) => c.id);
    this.data.cards = this.data.cards.filter((c) => c.boardId !== id);
    const activity = this.log({ kind: 'board.delete', memberId: this.actor(memberId), title: board.name });
    this.scheduleSave();
    return { id, removedCards, activity };
  }

  // ---------- cards ----------

  cleanCardFields(input, partial) {
    const out = {};
    if (!partial || 'title' in input) {
      out.title = cleanText(input.title, 200, 'title');
      if (!out.title) throw bad('Podaj nazwę zadania');
    }
    if ('notes' in input) out.notes = cleanText(input.notes, 5000, 'notes');
    if ('status' in input) {
      if (!STATUSES.includes(input.status)) throw bad('status: nieznany status');
      out.status = input.status;
    }
    if ('start' in input) out.start = cleanDate(input.start, 'start');
    if ('due' in input) out.due = cleanDate(input.due, 'due');
    if ('color' in input) out.color = cleanColor(input.color, 'color');
    if ('boardId' in input) {
      if (!this.board(input.boardId)) throw bad('boardId: tablica nie istnieje');
      out.boardId = input.boardId;
    }
    if ('order' in input) {
      if (typeof input.order !== 'number' || !Number.isFinite(input.order)) throw bad('order: oczekiwano liczby');
      out.order = input.order;
    }
    if ('assignees' in input) {
      if (!Array.isArray(input.assignees)) throw bad('assignees: oczekiwano listy');
      out.assignees = [...new Set(input.assignees.filter((id) => typeof id === 'string' && this.member(id)))].slice(0, 30);
    }
    if ('checklist' in input) {
      if (!Array.isArray(input.checklist)) throw bad('checklist: oczekiwano listy');
      out.checklist = input.checklist.slice(0, 100).map((item) => {
        if (!item || typeof item !== 'object') throw bad('checklist: niepoprawny element');
        return {
          id: typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : newId(),
          text: cleanText(item.text, 200, 'checklist'),
          done: item.done === true,
        };
      }).filter((item) => item.text);
    }
    return out;
  }

  createCard(input, memberId) {
    const fields = this.cleanCardFields(input, false);
    const boardId = fields.boardId ?? this.data.boards[0]?.id;
    if (!boardId) throw bad('Brak tablicy');
    const status = fields.status ?? 'planned';
    const now = new Date().toISOString();
    const actor = this.actor(memberId);
    const card = {
      id: cleanClientId(input.id),
      boardId,
      title: fields.title,
      notes: fields.notes ?? '',
      status,
      start: fields.start ?? null,
      due: fields.due ?? null,
      color: fields.color ?? null,
      assignees: fields.assignees ?? [],
      checklist: fields.checklist ?? [],
      order: fields.order ?? this.nextOrder(boardId, status),
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      doneAt: status === 'done' ? now : null,
    };
    if (this.card(card.id)) throw new HttpError(409, 'Takie zadanie już istnieje');
    normalizeRange(card);
    this.data.cards.push(card);
    const activity = this.log({ kind: 'card.create', memberId: actor, cardId: card.id, boardId, title: card.title, to: status });
    this.scheduleSave();
    return { card, activity };
  }

  updateCard(id, input, memberId) {
    const card = this.card(id);
    if (!card) throw notFound('Zadanie');
    const fields = this.cleanCardFields(input, true);
    const prevStatus = card.status;
    const actor = this.actor(memberId);
    if (fields.status && fields.status !== prevStatus && !('order' in fields)) {
      fields.order = this.nextOrder(fields.boardId ?? card.boardId, fields.status);
    }
    Object.assign(card, fields);
    normalizeRange(card, 'start' in fields && !('due' in fields) ? 'start' : 'due');
    const now = new Date().toISOString();
    card.updatedAt = now;
    card.updatedBy = actor;
    if (card.status !== prevStatus) card.doneAt = card.status === 'done' ? now : null;

    let activity = null;
    if (card.status !== prevStatus) {
      activity = this.log({ kind: 'card.move', memberId: actor, cardId: id, boardId: card.boardId, title: card.title, from: prevStatus, to: card.status });
    } else {
      const meaningful = Object.keys(fields).some((k) => k !== 'order');
      if (meaningful) {
        const last = this.data.activity[0];
        if (last && last.kind === 'card.update' && last.cardId === id && last.memberId === actor
          && Date.now() - Date.parse(last.at) < UPDATE_COALESCE_MS) {
          last.at = now;
          last.title = card.title;
          activity = last;
        } else {
          activity = this.log({ kind: 'card.update', memberId: actor, cardId: id, boardId: card.boardId, title: card.title });
        }
      }
    }
    this.scheduleSave();
    return { card, activity };
  }

  deleteCard(id, memberId) {
    const card = this.card(id);
    if (!card) throw notFound('Zadanie');
    this.data.cards = this.data.cards.filter((c) => c.id !== id);
    const activity = this.log({ kind: 'card.delete', memberId: this.actor(memberId), boardId: card.boardId, title: card.title });
    this.scheduleSave();
    return { id, activity };
  }
}

/** Keeps start <= due. `keep` names the field the user just set, which wins. */
function normalizeRange(card, keep = 'due') {
  if (card.start && card.due && card.start > card.due) {
    if (keep === 'start') card.due = card.start;
    else card.start = card.due;
  }
}
