import { h, icon, avatar, avatarStack, openMenu, toast, reducedMotion } from './ui.js';
import {
  state, subscribe, loadState, connect, api, me, memberById, currentBoard, setView, setBoard,
  setErrorHandler, setRemoteHandler, notify,
} from './state.js';
import { mountBoard, renderBoard } from './board.js';
import { mountCalendar, renderCalendar } from './calendar.js';
import { mountOverview, renderOverview, describeActivity } from './overview.js';
import { openCardSheet } from './cardSheet.js';
import { openSettings, showOnboarding, showPasscode, setReadyHandler, hideGate, newBoardFlow } from './settings.js';

const TITLES = { board: 'Tablica', calendar: 'Kalendarz', overview: 'Przegląd' };
const $ = (id) => document.getElementById(id);

let mounted = false;
let largeTitle;
let boardPicker;

function mountShell() {
  document.querySelectorAll('.tab-icon').forEach((el) => el.replaceWith(icon(el.dataset.icon, 'tab-icon')));
  $('addBtn').append(icon('plus'));
  $('addBtn').addEventListener('click', () => openCardSheet(null, state.view === 'calendar' ? {} : { status: 'planned' }));
  $('meBtn').addEventListener('click', openSettings);

  boardPicker = h('button.board-picker', { type: 'button', onclick: openBoardMenu });
  largeTitle = h('h1.large-title');
  $('main').prepend(h('div.title-block', largeTitle, boardPicker));

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      const icn = tab.querySelector('.icon');
      if (!reducedMotion()) icn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.8)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
      if (state.view === tab.dataset.tab) scrollTo({ top: 0, behavior: 'smooth' });
      else setView(tab.dataset.tab);
    });
  }

  mountBoard($('view-board'));
  mountCalendar($('view-calendar'));
  mountOverview($('view-overview'));

  const navbar = $('navbar');
  const onScroll = () => navbar.classList.toggle('scrolled', scrollY > 28);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderCalendar(), 150);
  });

  // Refresh relative dates ("Dziś", "5 min temu") now and then, and when coming back to the app.
  setInterval(() => notify('tick'), 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadState().catch(() => {});
  });

  subscribe(render);
  showView(state.view, false);
  mounted = true;
}

function openBoardMenu() {
  openMenu(boardPicker, [
    { label: 'Wszystkie tablice', icon: 'board', checked: state.boardId === 'all', action: () => setBoard('all') },
    '-',
    ...state.boards.map((b) => ({ label: `${b.emoji} ${b.name}`, checked: state.boardId === b.id, action: () => setBoard(b.id) })),
    '-',
    { label: 'Nowa tablica…', icon: 'plus', action: newBoardFlow },
    { label: 'Zarządzaj tablicami', icon: 'gear', action: openSettings },
  ]);
}

function showView(view, animate = true) {
  for (const section of document.querySelectorAll('.view')) {
    const active = section.dataset.view === view;
    if (active && section.hidden) {
      section.hidden = false;
      if (animate && !reducedMotion()) {
        section.animate([
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' },
        ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    } else if (!active) {
      section.hidden = true;
    }
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === view);
    tab.setAttribute('aria-current', tab.dataset.tab === view ? 'page' : 'false');
  }
  document.body.dataset.view = view;
  if (animate) scrollTo({ top: 0 });
}

function renderChrome() {
  largeTitle.textContent = TITLES[state.view];
  $('navTitleSmall').textContent = TITLES[state.view];
  const board = currentBoard();
  boardPicker.replaceChildren(
    h('span', board ? `${board.emoji} ${board.name}` : 'Wszystkie tablice'),
    icon('chevronDown'),
  );
  $('meBtn').replaceChildren(avatar(me(), 32));

  const others = state.online.filter((id) => id !== state.meId).map(memberById).filter(Boolean);
  const presence = $('presence');
  presence.replaceChildren(others.length ? avatarStack(others, 26, 3) : '');
  presence.title = others.length ? `Teraz online: ${others.map((m) => m.name).join(', ')}` : '';
  $('offline').hidden = state.connected;
}

let lastView = null;
function render(reasons) {
  if (!mounted) return;
  if (reasons.has('view') || lastView === null) {
    showView(state.view, lastView !== null);
    lastView = state.view;
  }
  renderChrome();
  if (reasons.size === 1 && (reasons.has('presence') || reasons.has('connection'))) {
    renderOverview();
    return;
  }
  renderBoard();
  renderCalendar();
  renderOverview();
}

function onRemote(ev) {
  if (!ev.activity || ev.activity.memberId === state.meId) return;
  const [who, ...rest] = describeActivity(ev.activity);
  const m = memberById(ev.activity.memberId);
  toast([m ? avatar(m, 26) : null, h('span', h('strong', who), rest.join(''))]);
}

async function start() {
  if (!mounted) mountShell();
  $('app').hidden = false;
  connect();
  // Pick up anything that happened before the live stream opened (e.g. our own join).
  loadState().catch(() => {});
  notify('data');
}

async function boot() {
  setErrorHandler((err) => toast(err.message, { tone: 'error' }));
  setRemoteHandler(onRemote);
  setReadyHandler(start);
  try {
    const session = await api('GET', '/session');
    if (session.authRequired && !session.authed) await showPasscode();
    await loadState();
  } catch (err) {
    $('gate').replaceChildren(h('div.gate.in', h('div.gate-card',
      h('h1', 'Brak połączenia'),
      h('p.muted', err.message),
      h('button.big-btn', { type: 'button', onclick: () => location.reload() }, 'Spróbuj ponownie'))));
    return;
  }
  if (!me()) {
    setView(state.view);
    showOnboarding();
    return;
  }
  hideGate();
  start();
}

boot();
