// Month calendar with continuous multi-day bars and an agenda for the selected day.
import { h, icon, avatarStack, reducedMotion, SPRING, reconcile } from './ui.js';
import { state, STATUS, visibleCards, memberById, boardById } from './state.js';
import { MONTHS, WEEKDAYS_SHORT, today, toIso, parseIso, addDays, weekdayMon, formatLong, formatRange, cardSpan } from './dates.js';
import { openCardSheet } from './cardSheet.js';
import { dueTone } from './cards.js';

let root;
let wrap;
let grid;
let monthLabel;
let agendaTitle;
let agendaList;
let agendaEmpty;
let month = firstOfMonth(today());
let selected = today();

function firstOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(iso, n) {
  const d = parseIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

const STATUS_RANK = { doing: 0, planned: 1, done: 2 };

export function mountCalendar(el) {
  root = el;
  monthLabel = h('h2.cal-month');
  const header = h('div.cal-header',
    monthLabel,
    h('div.cal-actions',
      h('button.pill-btn', { type: 'button', onclick: () => goTo(today()) }, 'Dziś'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Poprzedni miesiąc', onclick: () => changeMonth(-1) }, icon('chevronLeft')),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Następny miesiąc', onclick: () => changeMonth(1) }, icon('chevronRight'))));
  const weekdays = h('div.cal-weekdays', WEEKDAYS_SHORT.map((d) => h('span', d)));
  wrap = h('div.cal-wrap');
  grid = buildGrid(month);
  wrap.append(grid);

  agendaTitle = h('h3.agenda-title');
  agendaList = h('div.group.agenda-list');
  agendaEmpty = h('div.agenda-empty', 'Nic tu jeszcze nie ma.');
  const agenda = h('div.agenda',
    h('div.agenda-head', agendaTitle,
      h('button.pill-btn.accent', {
        type: 'button',
        onclick: () => openCardSheet(null, { due: selected }),
      }, icon('plus'), 'Dodaj')),
    agendaList, agendaEmpty);

  root.append(h('div.cal-card', header, weekdays, wrap), agenda);
  enableSwipe();
  renderCalendar();
}

function goTo(iso) {
  const target = firstOfMonth(iso);
  const dir = target > month ? 1 : target < month ? -1 : 0;
  selected = iso;
  if (dir) slideTo(target, dir);
  else renderCalendar();
}

function changeMonth(n) {
  slideTo(shiftMonth(month, n), n);
}

function slideTo(target, dir) {
  month = target;
  const old = grid;
  grid = buildGrid(month, true);
  if (firstOfMonth(selected) !== month) selected = month === firstOfMonth(today()) ? today() : month;
  if (reducedMotion()) {
    old.replaceWith(grid);
  } else {
    wrap.append(grid);
    old.classList.add('leaving');
    old.animate([
      { transform: 'translateX(0)', opacity: 1 },
      { transform: `translateX(${-dir * 40}%)`, opacity: 0 },
    ], { duration: 380, easing: SPRING }).onfinish = () => old.remove();
    grid.animate([
      { transform: `translateX(${dir * 40}%)`, opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 460, easing: SPRING });
  }
  renderCalendar();
}

function enableSwipe() {
  let start = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY };
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      wrap.dataset.swiped = '1';
      setTimeout(() => delete wrap.dataset.swiped, 50);
      changeMonth(dx < 0 ? 1 : -1);
    }
  });
  wrap.addEventListener('pointercancel', () => { start = null; });
}

function gridStart(monthIso) {
  return addDays(monthIso, -weekdayMon(monthIso));
}

function buildGrid(monthIso, animateBars = false) {
  const g = h('div.cal-grid');
  g.dataset.month = monthIso;
  g.dataset.animate = animateBars ? '1' : '';
  const start = gridStart(monthIso);
  for (let w = 0; w < 6; w++) {
    const week = h('div.cal-week');
    for (let d = 0; d < 7; d++) {
      const iso = addDays(start, w * 7 + d);
      const day = h('button.cal-day', {
        type: 'button',
        onclick: () => {
          if (wrap.dataset.swiped) return;
          selectDay(iso);
        },
      }, h('span.cal-num', String(parseIso(iso).getDate())), h('span.cal-more'));
      day.dataset.date = iso;
      if (iso.slice(0, 7) !== monthIso.slice(0, 7)) day.classList.add('outside');
      if (d >= 5) day.classList.add('weekend');
      week.append(day);
    }
    week.append(h('div.cal-bars'));
    g.append(week);
  }
  return g;
}

function selectDay(iso) {
  if (iso.slice(0, 7) !== month.slice(0, 7)) {
    goTo(iso);
    return;
  }
  selected = iso;
  renderCalendar();
}

export function renderCalendar() {
  if (!root) return;
  const [y, m] = month.split('-').map(Number);
  monthLabel.replaceChildren(h('span', MONTHS[m - 1]), ' ', h('span.cal-year', String(y)));

  const cards = visibleCards().filter(cardSpan);
  const maxLanes = innerWidth < 600 ? 2 : 3;
  const t = today();
  const animate = grid.dataset.animate === '1' && !reducedMotion();
  grid.dataset.animate = '';

  for (const week of grid.children) {
    const days = [...week.querySelectorAll('.cal-day')];
    const wStart = days[0].dataset.date;
    const wEnd = days[6].dataset.date;
    const inWeek = cards
      .map((c) => ({ c, span: cardSpan(c) }))
      .filter(({ span }) => span.start <= wEnd && span.end >= wStart)
      .sort((a, b) => (a.span.start < b.span.start ? -1 : a.span.start > b.span.start ? 1
        : (b.span.end > a.span.end ? 1 : b.span.end < a.span.end ? -1 : STATUS_RANK[a.c.status] - STATUS_RANK[b.c.status])));

    const laneEnds = [];
    const hidden = new Array(7).fill(0);
    const bars = [];
    for (const { c, span } of inWeek) {
      const s = span.start < wStart ? wStart : span.start;
      const e = span.end > wEnd ? wEnd : span.end;
      const c0 = weekdayMon(s);
      const c1 = weekdayMon(e);
      let lane = laneEnds.findIndex((end) => end < s);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = e;
      if (lane >= maxLanes) {
        for (let i = c0; i <= c1; i++) hidden[i]++;
        continue;
      }
      bars.push({ c, c0, span: c1 - c0 + 1, lane, contL: span.start < wStart, contR: span.end > wEnd });
    }

    days.forEach((day, i) => {
      const iso = day.dataset.date;
      day.classList.toggle('today', iso === t);
      day.classList.toggle('selected', iso === selected);
      const more = day.querySelector('.cal-more');
      more.textContent = hidden[i] ? `+${hidden[i]}` : '';
      day.setAttribute('aria-label', `${formatLong(iso)}${hidden[i] ? `, jeszcze ${hidden[i]}` : ''}`);
    });

    const barsEl = week.querySelector('.cal-bars');
    reconcile(barsEl, bars, (b) => b.c.id, (b) => {
      const el = h('button.cal-bar', { type: 'button', tabIndex: -1 });
      el.addEventListener('click', (ev) => {
        if (innerWidth < 600) return; // on phones a tap selects the day
        ev.stopPropagation();
        openCardSheet(el.dataset.key);
      });
      fillBar(el, b);
      if (animate) {
        el.animate([
          { opacity: 0, transform: 'scaleX(.6)' },
          { opacity: 1, transform: 'none' },
        ], { duration: 420, delay: 60 + b.lane * 40, easing: SPRING, fill: 'backwards' });
      }
      return el;
    }, fillBar);
  }

  renderAgenda(cards);
}

function fillBar(el, b) {
  const { c } = b;
  el.style.setProperty('--c0', b.c0);
  el.style.setProperty('--span', b.span);
  el.style.setProperty('--lane', b.lane);
  el.style.setProperty('--tint', `var(--${c.color || STATUS[c.status].color})`);
  el.className = `cal-bar status-${c.status}${b.contL ? ' cont-l' : ''}${b.contR ? ' cont-r' : ''}`;
  el.title = c.title;
  el.textContent = c.title;
}

function renderAgenda(cards) {
  agendaTitle.textContent = selected === today() ? `Dziś · ${formatLong(selected)}` : formatLong(selected);
  const items = cards
    .filter((c) => {
      const s = cardSpan(c);
      return s.start <= selected && s.end >= selected;
    })
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.title.localeCompare(b.title, 'pl'));

  agendaEmpty.hidden = items.length > 0;
  agendaList.hidden = !items.length;
  reconcile(agendaList, items, (c) => c.id, agendaRow, (el, c) => {
    const fresh = agendaRow(c);
    el.replaceChildren(...fresh.childNodes);
    el.className = fresh.className;
  });
}

export function agendaRow(card, { showDate = true } = {}) {
  const st = STATUS[card.status];
  const board = boardById(card.boardId);
  const people = card.assignees.map(memberById).filter(Boolean);
  const tone = dueTone(card);
  const sub = [board ? `${board.emoji} ${board.name}` : null, showDate ? formatRange(card.start, card.due) : null].filter(Boolean).join(' · ');
  const el = h(`button.row.tappable.agenda-row${card.status === 'done' ? '.is-done' : ''}`, {
    type: 'button',
    onclick: () => openCardSheet(card.id),
  },
  h('span.agenda-status', { style: { color: `var(--${st.color})` } }, icon(card.status === 'done' ? 'checkCircle' : card.status === 'doing' ? 'clock' : 'circle')),
  h('span.agenda-text',
    h('span.agenda-name', card.color ? h('span.dot', { style: { background: `var(--${card.color})` } }) : null, card.title),
    h(`span.agenda-sub${tone === 'overdue' ? '.overdue' : ''}`, `${st.label}${sub ? ` · ${sub}` : ''}`)),
  people.length ? avatarStack(people, 24) : null,
  icon('chevronRight', 'row-chevron'));
  return el;
}
