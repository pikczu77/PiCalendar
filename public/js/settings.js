// Profile, boards management, onboarding and the passcode gate.
import { h, icon, avatar, openSheet, openMenu, promptDialog, confirmDialog, toast } from './ui.js';
import {
  state, COLORS, me, api, createMember, updateMember, createBoard, updateBoard, deleteBoard,
  setBoard, setMe, subscribe,
} from './state.js';

let spaceId = null;
export function setSpaceId(id) {
  spaceId = id;
}

/** Link other people open to join: includes the team space in Firebase mode. */
function shareUrl() {
  const url = new URL(location.origin + location.pathname);
  if (spaceId) url.searchParams.set('s', spaceId);
  return url.toString();
}

const EMOJIS = ['📋', '🚀', '🏠', '💼', '🎨', '🛠️', '📚', '🎉', '🌱', '🧪', '✈️', '🍕', '💡', '🎯', '🏃', '❤️'];

function colorPicker(value, onPick) {
  const row = h('div.color-row');
  const render = () => row.replaceChildren(...COLORS.map((c) => h(`button.color-dot${value === c ? '.on' : ''}`, {
    type: 'button',
    'aria-label': c,
    style: { '--c': `var(--${c})` },
    onclick: () => {
      value = c;
      onPick(c);
      render();
    },
  })));
  render();
  return row;
}

// ---------- boards ----------

export async function newBoardFlow() {
  const name = await promptDialog({ title: 'Nowa tablica', message: 'Np. „Remont”, „Wyjazd”, „Projekt X”.', placeholder: 'Nazwa tablicy', confirmLabel: 'Utwórz' });
  if (!name) return;
  const board = await createBoard({ name, emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] }).catch(() => null);
  if (board) setBoard(board.id);
}

function boardRow(board) {
  const emojiBtn = h('button.emoji-btn', {
    type: 'button',
    'aria-label': 'Zmień ikonę',
    onclick: () => openMenu(emojiBtn, EMOJIS.map((e) => ({ label: e, checked: e === board.emoji, action: () => updateBoard(board.id, { emoji: e }).catch(() => {}) }))),
  }, board.emoji);
  const count = state.cards.filter((c) => c.boardId === board.id).length;
  return h('div.row',
    emojiBtn,
    h('span.row-label', board.name, h('span.row-sub', `${count} ${count === 1 ? 'zadanie' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'zadania' : 'zadań'}`)),
    h('button.icon-btn.small', {
      type: 'button',
      'aria-label': 'Zmień nazwę',
      onclick: async () => {
        const name = await promptDialog({ title: 'Zmień nazwę', value: board.name, placeholder: 'Nazwa tablicy' });
        if (name) updateBoard(board.id, { name }).catch(() => {});
      },
    }, icon('pencil')),
    h('button.icon-btn.small.danger', {
      type: 'button',
      'aria-label': 'Usuń tablicę',
      disabled: state.boards.length <= 1,
      onclick: async () => {
        const ok = await confirmDialog({
          title: `Usunąć „${board.name}”?`,
          message: 'Wszystkie zadania z tej tablicy zostaną usunięte dla całego zespołu.',
          confirmLabel: 'Usuń',
          destructive: true,
        });
        if (ok) deleteBoard(board.id).catch(() => {});
      },
    }, icon('trash')));
}

// ---------- settings sheet ----------

export function openSettings() {
  const self = me();
  const nameInput = h('input.text-input', { type: 'text', maxLength: 40, placeholder: 'Twoje imię', 'aria-label': 'Twoje imię' });
  nameInput.value = self?.name || '';
  let nameTimer;
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const name = nameInput.value.trim();
      if (name && self) updateMember(self.id, { name }).catch(() => {});
    }, 500);
  });
  const avatarSlot = h('div.profile-avatar');
  const renderAvatar = () => avatarSlot.replaceChildren(avatar(me(), 72));
  renderAvatar();

  const boards = h('div.group');
  const renderBoards = () => boards.replaceChildren(...state.boards.map(boardRow),
    h('button.row.tappable.accent-row', { type: 'button', onclick: newBoardFlow }, icon('plus'), 'Nowa tablica'));
  renderBoards();

  const content = h('div.settings',
    h('div.profile', avatarSlot,
      h('div.group.title-group', nameInput),
      colorPicker(self?.color, (c) => {
        if (self) updateMember(self.id, { color: c }).catch(() => {});
        renderAvatar();
      })),
    h('div.group-label', 'Tablice'),
    boards,
    h('div.group-label', 'Udostępnianie'),
    h('div.group.padded.help',
      h('p', spaceId
        ? 'Wyślij ten link osobom z zespołu — każdy wpisuje swoje imię i od razu widzi zmiany na żywo. Link działa jak klucz: kto go ma, ma dostęp.'
        : 'Wyślij innym adres tej strony — każdy wpisuje swoje imię i od razu widzi zmiany na żywo.'),
      h('div.share-row',
        h('code.share-url', shareUrl()),
        h('button.pill-btn.accent', {
          type: 'button',
          onclick: async () => {
            const url = shareUrl();
            try {
              if (navigator.share) await navigator.share({ title: 'PiCalendar', url });
              else {
                await navigator.clipboard.writeText(url);
                toast('Skopiowano link');
              }
            } catch { /* cancelled */ }
          },
        }, 'Udostępnij'))),
    h('div.group',
      h('button.row.tappable', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Zmienić użytkownika?', message: 'Na tym urządzeniu wybierzesz inną osobę z zespołu albo dołączysz jako nowa.', confirmLabel: 'Zmień' });
          if (!ok) return;
          sheet.close();
          setMe(null);
          showOnboarding();
        },
      }, icon('person'), 'To nie ja — zmień użytkownika')),
    h('div.sheet-footnote', 'PiCalendar · dane zapisywane na serwerze zespołu'));

  const unsubscribe = subscribe(() => {
    renderBoards();
    renderAvatar();
  });
  const sheet = openSheet({
    title: 'Ustawienia',
    right: { label: 'Gotowe', bold: true, action: () => sheet.close() },
    content,
    onClose: () => {
      unsubscribe();
      clearTimeout(nameTimer);
      const name = nameInput.value.trim();
      if (self && name && name !== me()?.name) updateMember(self.id, { name }).catch(() => {});
    },
  });
}

// ---------- full-screen gates ----------

let onReady = () => {};
export function setReadyHandler(fn) {
  onReady = fn;
}

function showGate(content) {
  const gate = document.getElementById('gate');
  document.getElementById('app').hidden = true;
  gate.replaceChildren(h('div.gate', h('div.gate-card', content)));
  requestAnimationFrame(() => gate.firstChild.classList.add('in'));
}

export function hideGate() {
  const gate = document.getElementById('gate');
  const el = gate.firstChild;
  document.getElementById('app').hidden = false;
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 450);
}

export function showPasscode() {
  return new Promise((resolve) => {
    const input = h('input.text-input.center', { type: 'password', placeholder: 'Kod dostępu', autocomplete: 'current-password', 'aria-label': 'Kod dostępu' });
    const error = h('div.gate-error');
    const submit = async () => {
      error.textContent = '';
      try {
        await api('POST', '/login', { passcode: input.value });
        resolve();
      } catch (err) {
        error.textContent = err.message;
        input.parentElement.animate([
          { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' },
          { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' },
        ], { duration: 360 });
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    showGate([
      h('img.gate-icon', { src: 'icon.svg', alt: '' }),
      h('h1', 'PiCalendar'),
      h('p.muted', 'Ta przestrzeń jest chroniona. Wpisz kod od swojego zespołu.'),
      h('div.group.title-group', input),
      error,
      h('button.big-btn', { type: 'button', onclick: submit }, 'Wejdź'),
    ]);
    setTimeout(() => input.focus(), 300);
  });
}

export function showOnboarding() {
  let color = COLORS[Math.floor(Math.random() * 8)];
  const input = h('input.text-input.center', { type: 'text', maxLength: 40, placeholder: 'Twoje imię', autocomplete: 'given-name', 'aria-label': 'Twoje imię', enterkeyhint: 'go' });
  const preview = h('div.gate-avatar');
  const renderPreview = () => preview.replaceChildren(avatar({ name: input.value || '?', color }, 84));
  renderPreview();
  const go = h('button.big-btn', { type: 'button', disabled: true }, 'Dołącz');
  const error = h('div.gate-error');
  input.addEventListener('input', () => {
    go.disabled = !input.value.trim();
    renderPreview();
  });
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    go.disabled = true;
    try {
      await createMember({ name, color });
      hideGate();
      onReady();
    } catch (err) {
      error.textContent = err.message;
      go.disabled = false;
    }
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const existing = state.members.length
    ? [h('div.group-label', 'Jesteś już w zespole? Wybierz siebie'),
      h('div.group.padded.people', state.members.map((m) => h('button.person', {
        type: 'button',
        onclick: () => {
          setMe(m.id);
          hideGate();
          onReady();
        },
      }, h('span.person-avatar', avatar(m, 44)), h('span.person-name', m.name))))]
    : null;

  showGate([
    h('img.gate-icon', { src: 'icon.svg', alt: '' }),
    h('h1', 'Witaj w PiCalendar'),
    h('p.muted', 'Wspólna tablica i kalendarz: co planujecie, co się robi, a co jest już gotowe.'),
    preview,
    h('div.group.title-group', input),
    colorPicker(color, (c) => {
      color = c;
      renderPreview();
    }),
    error,
    go,
    existing,
  ]);
  setTimeout(() => input.focus(), 350);
}

/** Firebase mode, first launch: create a new team space or join one with a link/code. */
export function showSpaceGate(fb) {
  return new Promise((resolve) => {
    const error = h('div.gate-error');
    const input = h('input.text-input.center', { type: 'text', placeholder: 'Wklej link lub kod', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, 'aria-label': 'Link lub kod zespołu' });
    const create = h('button.big-btn', { type: 'button' }, 'Utwórz przestrzeń zespołu');
    const join = h('button.big-btn.secondary', { type: 'button' }, 'Dołącz');
    const busy = (on) => {
      create.disabled = on;
      join.disabled = on;
    };
    create.addEventListener('click', async () => {
      busy(true);
      error.textContent = '';
      try {
        resolve(await fb.createSpace());
      } catch (err) {
        console.error(err);
        error.textContent = err.code === 'permission-denied' ? 'Brak dostępu — sprawdź reguły Firestore.' : 'Nie udało się utworzyć przestrzeni. Sprawdź połączenie.';
        busy(false);
      }
    });
    const tryJoin = async () => {
      const raw = input.value.trim();
      const code = (raw.match(/[?&]s=([A-Za-z0-9_-]+)/) || [null, raw])[1];
      error.textContent = '';
      if (!fb.SPACE_RE.test(code)) {
        error.textContent = 'To nie wygląda na link ani kod zespołu.';
        return;
      }
      busy(true);
      try {
        if (await fb.spaceExists(code)) resolve(code);
        else error.textContent = 'Nie znaleziono takiej przestrzeni.';
      } catch {
        error.textContent = 'Nie udało się sprawdzić kodu. Sprawdź połączenie.';
      }
      busy(false);
    };
    join.addEventListener('click', tryJoin);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && tryJoin());
    showGate([
      h('img.gate-icon', { src: 'icon.svg', alt: '' }),
      h('h1', 'PiCalendar'),
      h('p.muted', 'Wspólna tablica i kalendarz dla Twojego zespołu. Zacznij od nowej przestrzeni albo dołącz do istniejącej.'),
      create,
      error,
      h('div.group-label', 'Masz link od zespołu?'),
      h('div.group.title-group', input),
      join,
    ]);
  });
}
