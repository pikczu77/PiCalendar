// Overview: progress summary, upcoming deadlines, who's online and the team's activity feed.
import { h, icon, avatar, reconcile } from './ui.js';
import { state, STATUS, STATUS_KEYS, visibleCards, memberById, boardById } from './state.js';
import { today, addDays, timeAgo, cardSpan } from './dates.js';
import { agendaRow } from './calendar.js';
import { openCardSheet } from './cardSheet.js';

let root;
let ring;
let ringLabel;
let tiles;
let upcoming;
let upcomingEmpty;
let team;
let feed;
let feedEmpty;

export function mountOverview(el) {
  root = el;
  ring = h('div.ring');
  ringLabel = h('div.ring-label');
  tiles = h('div.tiles');
  upcoming = h('div.group');
  upcomingEmpty = h('div.agenda-empty', 'Brak terminów w najbliższym tygodniu. 🌤️');
  team = h('div.group.padded.team');
  feed = h('div.group.feed');
  feedEmpty = h('div.agenda-empty', 'Tu pojawi się, kto co zmienił.');

  root.append(
    h('div.summary', h('div.ring-wrap', ring, ringLabel), tiles),
    h('div.group-label', 'Najbliższe 7 dni'),
    upcoming, upcomingEmpty,
    h('div.group-label', 'Zespół'),
    team,
    h('div.group-label', 'Ostatnia aktywność'),
    feed, feedEmpty,
  );
  renderOverview();
}

function tile(key, label, value, tint, iconName) {
  const el = h('div.tile', { style: { '--tint': `var(--${tint})` } },
    h('span.tile-icon', icon(iconName)),
    h('span.tile-value', String(value)),
    h('span.tile-label', label));
  el.dataset.key = key;
  return el;
}

export function renderOverview() {
  if (!root) return;
  const cards = visibleCards();
  const t = today();
  const counts = Object.fromEntries(STATUS_KEYS.map((s) => [s, cards.filter((c) => c.status === s).length]));
  const overdue = cards.filter((c) => c.status !== 'done' && c.due && c.due < t).length;
  const pct = cards.length ? Math.round((counts.done / cards.length) * 100) : 0;

  ring.style.setProperty('--pct', pct);
  ringLabel.replaceChildren(h('strong', `${pct}%`), h('span', 'gotowe'));

  const tileData = [
    ['planned', STATUS.planned.label, counts.planned, STATUS.planned.color, 'circle'],
    ['doing', STATUS.doing.label, counts.doing, STATUS.doing.color, 'clock'],
    ['done', STATUS.done.label, counts.done, STATUS.done.color, 'checkCircle'],
    ['overdue', 'Po terminie', overdue, overdue ? 'red' : 'gray', 'flag'],
  ];
  reconcile(tiles, tileData, (d) => d[0], (d) => tile(...d), (el, d) => {
    const v = el.querySelector('.tile-value');
    if (v.textContent !== String(d[2])) {
      v.textContent = String(d[2]);
      v.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
    el.style.setProperty('--tint', `var(--${d[3]})`);
  });

  // Upcoming: open cards ending within the next 7 days (and overdue ones first).
  const horizon = addDays(t, 7);
  const soon = cards
    .filter((c) => c.status !== 'done' && cardSpan(c) && cardSpan(c).end <= horizon)
    .sort((a, b) => (cardSpan(a).end < cardSpan(b).end ? -1 : 1))
    .slice(0, 12);
  upcoming.hidden = !soon.length;
  upcomingEmpty.hidden = soon.length > 0;
  reconcile(upcoming, soon, (c) => c.id, (c) => agendaRow(c), (el, c) => {
    const fresh = agendaRow(c);
    el.replaceChildren(...fresh.childNodes);
    el.className = fresh.className;
  });

  // Team
  const online = new Set(state.online);
  const members = [...state.members].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name, 'pl'));
  team.replaceChildren(...members.map((m) => {
    const active = cards.filter((c) => c.status === 'doing' && c.assignees.includes(m.id)).length;
    return h('div.team-member',
      h('span.team-avatar', avatar(m, 44), online.has(m.id) ? h('span.online-dot') : null),
      h('span.team-name', m.id === state.meId ? `${m.name} (Ty)` : m.name),
      h('span.team-sub', active ? `${active} w trakcie` : online.has(m.id) ? 'online' : ' '));
  }));
  if (!members.length) team.append(h('div.muted', 'Nikt jeszcze nie dołączył.'));

  // Activity feed
  const items = state.activity
    .filter((a) => state.boardId === 'all' || !a.boardId || a.boardId === state.boardId)
    .slice(0, 30);
  feed.hidden = !items.length;
  feedEmpty.hidden = items.length > 0;
  reconcile(feed, items, (a) => a.id, activityRow, (el, a) => {
    const fresh = activityRow(a);
    el.replaceChildren(...fresh.childNodes);
  });
}

export function describeActivity(a) {
  const who = memberById(a.memberId)?.name || 'Ktoś';
  const title = `„${a.title}”`;
  switch (a.kind) {
    case 'card.create': return [who, ' dodał(a) ', title];
    case 'card.move': return [who, ' przeniósł(a) ', title, ' → ', STATUS[a.to]?.label || a.to];
    case 'card.update': return [who, ' zaktualizował(a) ', title];
    case 'card.delete': return [who, ' usunął(ęła) ', title];
    case 'board.create': return [who, ' utworzył(a) tablicę ', title];
    case 'board.delete': return [who, ' usunął(ęła) tablicę ', title];
    case 'member.join': return [a.title, ' dołączył(a) do zespołu 👋'];
    default: return [who, ' coś zmienił(a)'];
  }
}

function activityRow(a) {
  const member = memberById(a.memberId);
  const board = a.boardId ? boardById(a.boardId) : null;
  const [who, ...rest] = describeActivity(a);
  const clickable = a.cardId && state.cards.some((c) => c.id === a.cardId);
  const tint = a.kind === 'card.move' ? STATUS[a.to]?.color : null;
  return h(`${clickable ? 'button' : 'div'}.row.feed-row${clickable ? '.tappable' : ''}`, {
    type: clickable ? 'button' : undefined,
    onclick: clickable ? () => openCardSheet(a.cardId) : undefined,
  },
  avatar(member, 32),
  h('span.feed-text',
    h('span.feed-line', h('strong', who), ...rest.map((part) => (tint && STATUS[a.to]?.label === part ? h('span.feed-status', { style: { color: `var(--${tint})` } }, part) : part))),
    h('span.feed-sub', [timeAgo(a.at), state.boardId === 'all' && board ? `${board.emoji} ${board.name}` : null].filter(Boolean).join(' · '))));
}
