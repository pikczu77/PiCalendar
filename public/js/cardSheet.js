// Card editor presented as an iOS sheet. Existing cards autosave; new ones use Cancel/Add.
import { h, icon, avatar, openSheet, openMenu, segmented, confirmDialog, toast } from './ui.js';
import {
  state, STATUS, STATUS_KEYS, COLORS, uid, cardById, boardById, memberById,
  createCard, updateCard, deleteCard, subscribe,
} from './state.js';
import { timeAgo } from './dates.js';
import { celebrate } from './board.js';

const COLOR_NAMES = {
  blue: 'Niebieski', green: 'Zielony', orange: 'Pomarańczowy', red: 'Czerwony', purple: 'Fioletowy',
  pink: 'Różowy', teal: 'Morski', yellow: 'Żółty', indigo: 'Indygo', gray: 'Szary',
};

export function openCardSheet(cardId, preset = {}) {
  const existing = cardId ? cardById(cardId) : null;
  if (cardId && !existing) return;
  const isNew = !existing;
  const defaultBoard = state.boardId !== 'all' ? state.boardId : state.boards[0]?.id;
  const draft = structuredClone(existing || {
    title: '',
    notes: '',
    status: 'planned',
    boardId: defaultBoard,
    start: null,
    due: null,
    color: null,
    assignees: state.meId ? [state.meId] : [],
    checklist: [],
    ...preset,
  });

  const dirty = new Set();
  let saveTimer = null;
  const flush = () => {
    clearTimeout(saveTimer);
    if (isNew || !dirty.size || !cardById(cardId)) return;
    const patch = {};
    for (const key of dirty) patch[key] = draft[key];
    dirty.clear();
    updateCard(cardId, patch).catch(() => {});
  };
  const change = (key, value, { immediate = false } = {}) => {
    draft[key] = value;
    if (isNew) {
      sheet.setRight(addButton());
      return;
    }
    dirty.add(key);
    clearTimeout(saveTimer);
    if (immediate) flush();
    else saveTimer = setTimeout(flush, 500);
  };

  // --- title ---
  const title = h('textarea.title-input', {
    rows: 1,
    placeholder: 'Nazwa zadania',
    maxLength: 200,
    enterkeyhint: 'done',
    'aria-label': 'Nazwa zadania',
  });
  title.value = draft.title;
  const grow = () => {
    title.style.height = 'auto';
    title.style.height = `${title.scrollHeight}px`;
  };
  title.addEventListener('input', () => {
    grow();
    change('title', title.value.trim() ? title.value.replace(/\n/g, ' ') : draft.title);
    if (isNew) draft.title = title.value.replace(/\n/g, ' ');
    if (isNew) sheet.setRight(addButton());
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      title.blur();
      if (isNew && draft.title.trim()) submitNew();
    }
  });

  // --- status ---
  const status = segmented(
    STATUS_KEYS.map((s) => ({ value: s, label: STATUS[s].label, dot: STATUS[s].color })),
    draft.status,
    (s) => {
      if (s === 'done' && draft.status !== 'done') celebrate(status);
      change('status', s, { immediate: true });
    },
  );

  // --- board / dates ---
  const boardValue = h('span.row-value');
  const renderBoardValue = () => {
    const b = boardById(draft.boardId);
    boardValue.textContent = b ? `${b.emoji} ${b.name}` : '—';
  };
  renderBoardValue();
  const boardRow = h('button.row.tappable', {
    type: 'button',
    onclick: () => openMenu(boardValue, state.boards.map((b) => ({
      label: `${b.emoji} ${b.name}`,
      checked: b.id === draft.boardId,
      action: () => {
        change('boardId', b.id, { immediate: true });
        renderBoardValue();
      },
    })), { align: 'right' }),
  }, h('span.row-icon', { style: { background: 'var(--blue)' } }, icon('board')), h('span.row-label', 'Tablica'), boardValue, icon('chevronDown', 'row-chevron'));

  const dateRow = (key, label, tint, iconName) => {
    const input = h('input.date-input', { type: 'date', 'aria-label': label });
    input.value = draft[key] || '';
    const clear = h('button.clear-btn', { type: 'button', 'aria-label': `Wyczyść: ${label}` }, icon('xmark'));
    const sync = () => {
      clear.hidden = !input.value;
      input.classList.toggle('empty', !input.value);
    };
    input.addEventListener('change', () => {
      change(key, input.value || null, { immediate: true });
      // Keep the range valid in the UI too.
      if (draft.start && draft.due && draft.start > draft.due) {
        const other = key === 'start' ? 'due' : 'start';
        draft[other] = draft[key];
        rows[other].input.value = draft[key];
        rows[other].sync();
        if (!isNew) dirty.add(other);
        flush();
      }
      sync();
    });
    clear.addEventListener('click', () => {
      input.value = '';
      change(key, null, { immediate: true });
      sync();
    });
    sync();
    const row = h('label.row', h('span.row-icon', { style: { background: `var(--${tint})` } }, icon(iconName)), h('span.row-label', label), h('span.row-value', input, clear));
    return { row, input, sync };
  };
  const rows = {
    start: dateRow('start', 'Początek', 'green', 'calendar'),
    due: dateRow('due', 'Termin', 'red', 'flag'),
  };

  // --- people ---
  const people = h('div.people');
  const renderPeople = () => {
    people.replaceChildren(...state.members.map((m) => {
      const on = draft.assignees.includes(m.id);
      return h(`button.person${on ? '.on' : ''}`, {
        type: 'button',
        'aria-pressed': String(on),
        onclick: () => {
          const next = on ? draft.assignees.filter((id) => id !== m.id) : [...draft.assignees, m.id];
          change('assignees', next, { immediate: true });
          renderPeople();
        },
      }, h('span.person-avatar', avatar(m, 40), h('span.person-check', icon('check'))), h('span.person-name', m.id === state.meId ? 'Ty' : m.name));
    }));
    if (!state.members.length) people.append(h('div.muted', 'Nikt jeszcze nie dołączył.'));
  };
  renderPeople();

  // --- color ---
  const colors = h('div.color-row');
  const renderColors = () => {
    colors.replaceChildren(
      h(`button.color-dot.none${!draft.color ? '.on' : ''}`, { type: 'button', 'aria-label': 'Bez koloru', onclick: () => { change('color', null, { immediate: true }); renderColors(); } }, icon('xmark')),
      ...COLORS.map((c) => h(`button.color-dot${draft.color === c ? '.on' : ''}`, {
        type: 'button',
        'aria-label': COLOR_NAMES[c],
        style: { '--c': `var(--${c})` },
        onclick: () => { change('color', c, { immediate: true }); renderColors(); },
      })),
    );
  };
  renderColors();

  // --- checklist ---
  const checklist = h('div.checklist');
  const progress = h('div.progress', h('span.progress-fill'));
  const renderChecklist = (focusId) => {
    const items = draft.checklist;
    const done = items.filter((i) => i.done).length;
    progress.hidden = !items.length;
    progress.firstChild.style.width = `${items.length ? (done / items.length) * 100 : 0}%`;
    checklist.replaceChildren(...items.map((item) => {
      const text = h('input.check-text', { type: 'text', maxLength: 200, 'aria-label': 'Punkt listy', enterkeyhint: 'done' });
      text.value = item.text;
      text.addEventListener('input', () => {
        item.text = text.value;
        change('checklist', draft.checklist);
      });
      text.addEventListener('blur', () => {
        if (!item.text.trim()) {
          draft.checklist = draft.checklist.filter((i) => i !== item);
          change('checklist', draft.checklist, { immediate: true });
          renderChecklist();
        }
      });
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          newItem.focus();
        }
      });
      const row = h(`div.check-item${item.done ? '.done' : ''}`,
        h('button.check-toggle', {
          type: 'button',
          'aria-label': item.done ? 'Oznacz jako niezrobione' : 'Oznacz jako zrobione',
          onclick: () => {
            item.done = !item.done;
            change('checklist', draft.checklist, { immediate: true });
            renderChecklist();
          },
        }, icon(item.done ? 'checkCircle' : 'circle')),
        text,
        h('button.check-remove', {
          type: 'button',
          'aria-label': 'Usuń punkt',
          onclick: () => {
            draft.checklist = draft.checklist.filter((i) => i !== item);
            change('checklist', draft.checklist, { immediate: true });
            renderChecklist();
          },
        }, icon('xmark')));
      if (item.id === focusId) requestAnimationFrame(() => text.focus());
      return row;
    }));
  };
  const newItem = h('input.check-new', { type: 'text', placeholder: 'Dodaj punkt', maxLength: 200, enterkeyhint: 'next', 'aria-label': 'Nowy punkt listy' });
  const addItem = () => {
    const text = newItem.value.trim();
    if (!text) return;
    draft.checklist = [...draft.checklist, { id: uid(), text, done: false }];
    newItem.value = '';
    change('checklist', draft.checklist, { immediate: true });
    renderChecklist();
  };
  newItem.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  });
  newItem.addEventListener('blur', addItem);
  renderChecklist();

  // --- notes ---
  const notes = h('textarea.notes-input', { placeholder: 'Notatki, linki, szczegóły…', maxLength: 5000, rows: 4, 'aria-label': 'Notatki' });
  notes.value = draft.notes;
  notes.addEventListener('input', () => change('notes', notes.value));

  // --- meta + delete ---
  const metaLine = () => {
    if (isNew) return null;
    const c = cardById(cardId) || existing;
    const author = memberById(c.createdBy);
    const editor = memberById(c.updatedBy);
    const parts = [`Dodane ${timeAgo(c.createdAt)}${author ? ` przez ${author.name}` : ''}`];
    if (c.updatedAt !== c.createdAt) parts.push(`zmienione ${timeAgo(c.updatedAt)}${editor ? ` przez ${editor.name}` : ''}`);
    return h('div.sheet-footnote', parts.join(' · '));
  };

  const content = h('div.card-editor',
    h('div.group.title-group', title),
    h('div.section', status),
    h('div.group', boardRow, rows.start.row, rows.due.row),
    h('div.group-label', 'Osoby'),
    h('div.group.padded', people),
    h('div.group-label', 'Kolor'),
    h('div.group.padded', colors),
    h('div.group-label', 'Lista kontrolna'),
    h('div.group', progress, checklist, h('div.check-item.adder', h('span.check-toggle.ghost', icon('plus')), newItem)),
    h('div.group-label', 'Notatki'),
    h('div.group', notes),
    metaLine(),
    isNew ? null : h('div.group', h('button.row.destructive-row', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Usunąć zadanie?',
          message: `„${draft.title}” zniknie dla wszystkich.`,
          confirmLabel: 'Usuń',
          destructive: true,
        });
        if (!ok) return;
        clearTimeout(saveTimer);
        dirty.clear();
        sheet.close('deleted');
        deleteCard(cardId).catch(() => {});
      },
    }, icon('trash'), 'Usuń zadanie')));

  function submitNew() {
    const t = draft.title.trim();
    if (!t) return;
    addItem();
    createCard({ ...draft, title: t, notes: notes.value }).catch(() => {});
    sheet.close('added');
  }

  function addButton() {
    return { label: 'Dodaj', bold: true, disabled: !draft.title.trim(), action: submitNew };
  }

  const sheet = openSheet({
    title: isNew ? 'Nowe zadanie' : '',
    left: isNew ? { label: 'Anuluj', action: () => sheet.close('cancel') } : null,
    right: isNew ? addButton() : { label: 'Gotowe', bold: true, action: () => sheet.close('done') },
    content,
    className: 'card-sheet',
    onClose: (reason) => {
      if (!isNew) flush();
      unsubscribe();
      if (isNew && reason !== 'added' && reason !== 'cancel' && draft.title.trim()) {
        // Swiped away with a title typed: keep it rather than losing the work.
        createCard({ ...draft, title: draft.title.trim(), notes: notes.value }).catch(() => {});
      }
    },
  });

  // Close if someone else deletes the card while it's open.
  const unsubscribe = subscribe(() => {
    if (!isNew && !cardById(cardId)) {
      unsubscribe();
      sheet.close('deleted');
      toast('To zadanie zostało usunięte.');
    }
  });

  requestAnimationFrame(() => {
    grow();
    if (isNew) title.focus();
  });
}
