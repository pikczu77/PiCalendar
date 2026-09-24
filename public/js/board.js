// Kanban board: three status columns with animated drag & drop (mouse and touch).
import { h, icon, flip, reconcile, segmented, tapFeedback, SPRING, reducedMotion } from './ui.js';
import { state, STATUS, STATUS_KEYS, cardsByStatus, visibleCards, cardById, updateCard, setOnlyMine, me } from './state.js';
import { cardTile, updateCardTile } from './cards.js';
import { openCardSheet } from './cardSheet.js';

let root;
let scroller;
let seg;
let mineChip;
const columns = {};
let drag = null;
let renderPending = false;
let suppressClick = false;

export function mountBoard(el) {
  root = el;
  seg = segmented(
    STATUS_KEYS.map((s) => ({ value: s, label: STATUS[s].short, dot: STATUS[s].color })),
    'planned',
    (s) => columns[s].col.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', inline: 'start', block: 'nearest' }),
  );
  mineChip = h('button.chip-toggle', { type: 'button', onclick: () => setOnlyMine(!state.onlyMine) }, icon('person'), 'Tylko moje');
  scroller = h('div.board-scroller');
  for (const status of STATUS_KEYS) {
    const count = h('span.column-count');
    const list = h('div.column-list');
    list.dataset.status = status;
    const col = h('div.column',
      h('div.column-header',
        h('span.status-dot', { style: { background: `var(--${STATUS[status].color})` } }),
        h('span.column-name', STATUS[status].label),
        count,
        h('button.icon-btn.small', { type: 'button', 'aria-label': `Dodaj do: ${STATUS[status].label}`, onclick: () => openCardSheet(null, { status }) }, icon('plus'))),
      list,
      h('button.add-card', { type: 'button', onclick: () => openCardSheet(null, { status }) }, icon('plus'), 'Nowe zadanie'));
    col.dataset.status = status;
    columns[status] = { col, list, count };
    scroller.append(col);
  }
  root.append(h('div.board-toolbar', seg, mineChip), scroller);

  scroller.addEventListener('scroll', () => {
    if (innerWidth >= 900) return;
    const w = scroller.firstElementChild.offsetWidth;
    const i = Math.round(scroller.scrollLeft / Math.max(1, w));
    seg.set(STATUS_KEYS[Math.min(2, i)]);
  }, { passive: true });

  scroller.addEventListener('click', (e) => {
    if (suppressClick) {
      e.stopPropagation();
      return;
    }
    const el = e.target.closest('.card');
    if (el) openCardSheet(el.dataset.id);
  });
  scroller.addEventListener('keydown', (e) => {
    const el = e.target.closest('.card');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openCardSheet(el.dataset.id);
    }
  });
  scroller.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.card') && e.pointerType !== 'mouse') e.preventDefault();
  });
  scroller.addEventListener('pointerdown', onPointerDown);
  addEventListener('touchmove', (e) => {
    if (drag?.active) e.preventDefault();
  }, { passive: false });

  renderBoard(true);
}

export function renderBoard(initial = false) {
  if (!root) return;
  if (drag?.active) {
    renderPending = true;
    return;
  }
  mineChip.classList.toggle('on', state.onlyMine);
  mineChip.hidden = !me();
  const cards = visibleCards();
  const apply = () => {
    for (const status of STATUS_KEYS) {
      const items = cardsByStatus(status, cards);
      const { list, count } = columns[status];
      reconcile(list, items, (c) => c.id, cardTile, updateCardTile);
      count.textContent = items.length;
      list.classList.toggle('empty', items.length === 0);
    }
  };
  if (initial || root.hidden) apply();
  else flip(scroller, apply);
}

// ---------- drag & drop ----------

function onPointerDown(e) {
  const el = e.target.closest('.card');
  if (!el || e.button > 0 || drag) return;
  const touch = e.pointerType !== 'mouse';
  drag = {
    el,
    id: el.dataset.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    touch,
    active: false,
    timer: touch ? setTimeout(() => startDrag(), 320) : null,
  };
  if (touch) el.classList.add('pressing');
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  addEventListener('pointercancel', onPointerCancel);
}

function cleanupListeners() {
  removeEventListener('pointermove', onPointerMove);
  removeEventListener('pointerup', onPointerUp);
  removeEventListener('pointercancel', onPointerCancel);
}

function cancelPending() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.el.classList.remove('pressing');
  drag = null;
  cleanupListeners();
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (!drag.active) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (drag.touch && dist > 10) cancelPending();
    else if (!drag.touch && dist > 5) startDrag();
    return;
  }
  e.preventDefault();
  moveGhost();
  updateTarget();
}

function onPointerCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.active) drop(true);
  else cancelPending();
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.active) drop(false);
  else cancelPending();
}

function startDrag() {
  if (!drag || drag.active) return;
  const { el } = drag;
  el.classList.remove('pressing');
  const rect = el.getBoundingClientRect();
  drag.active = true;
  drag.rect = rect;
  drag.offsetX = drag.x - rect.left;
  drag.offsetY = drag.y - rect.top;
  drag.origin = { status: el.parentElement.dataset.status, next: el.nextElementSibling };

  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-flip');
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(ghost);
  drag.ghost = ghost;
  el.classList.add('placeholder');
  document.documentElement.classList.add('is-dragging');
  tapFeedback();
  moveGhost();
  requestAnimationFrame(() => ghost.classList.add('lifted'));
  autoScroll();
}

function moveGhost() {
  const { ghost, rect, x, y, offsetX, offsetY } = drag;
  ghost.style.setProperty('--dx', `${x - offsetX - rect.left}px`);
  ghost.style.setProperty('--dy', `${y - offsetY - rect.top}px`);
}

function listAt(x, y) {
  const under = document.elementFromPoint(x, y);
  const col = under?.closest('.column');
  if (col) return columns[col.dataset.status].list;
  // Between/around columns: pick the horizontally closest column.
  let best = null;
  let bestDist = Infinity;
  for (const s of STATUS_KEYS) {
    const r = columns[s].col.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < bestDist && r.width) {
      best = columns[s].list;
      bestDist = d;
    }
  }
  return bestDist < 80 ? best : null;
}

function updateTarget() {
  const list = listAt(drag.x, drag.y);
  if (!list) return;
  const { el } = drag;
  let ref = null;
  for (const child of list.children) {
    if (child === el) continue;
    const r = child.getBoundingClientRect();
    if (drag.y < r.top + r.height / 2) {
      ref = child;
      break;
    }
  }
  if (el.parentElement === list && el.nextElementSibling === ref) return;
  if (ref && ref.previousElementSibling === el && el.parentElement === list) return;
  flip(scroller, () => {
    list.insertBefore(el, ref);
    for (const s of STATUS_KEYS) {
      columns[s].list.classList.toggle('drop-target', columns[s].list === list);
      columns[s].list.classList.toggle('empty', !columns[s].list.children.length);
    }
  });
}

function autoScroll() {
  if (!drag?.active) return;
  const edge = 56;
  const { x, y } = drag;
  const sr = scroller.getBoundingClientRect();
  let sx = 0;
  if (x < sr.left + edge) sx = -Math.ceil((sr.left + edge - x) / 4);
  else if (x > sr.right - edge) sx = Math.ceil((x - (sr.right - edge)) / 4);
  let sy = 0;
  const top = 110;
  const bottom = innerHeight - 100;
  if (y < top) sy = -Math.ceil((top - y) / 5);
  else if (y > bottom) sy = Math.ceil((y - bottom) / 5);
  if (sx) scroller.scrollLeft += sx;
  if (sy) scrollBy(0, sy);
  if (sx || sy) updateTarget();
  requestAnimationFrame(autoScroll);
}

function orderBetween(prevEl, nextEl) {
  const prev = prevEl ? cardById(prevEl.dataset.id)?.order : undefined;
  const next = nextEl ? cardById(nextEl.dataset.id)?.order : undefined;
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + 1;
  if (next !== undefined) return next - 1;
  return 1;
}

function drop(cancelled) {
  const { el, ghost, id, origin } = drag;
  cleanupListeners();
  if (cancelled) {
    origin && columns[origin.status].list.insertBefore(el, origin.next?.parentElement ? origin.next : null);
  }
  const list = el.parentElement;
  const status = list.dataset.status;
  const moved = !cancelled && (status !== origin.status || el.nextElementSibling !== origin.next);
  const card = cardById(id);
  const patch = {};
  if (moved && card) {
    if (status !== card.status) patch.status = status;
    patch.order = orderBetween(el.previousElementSibling, el.nextElementSibling);
  }

  const target = el.getBoundingClientRect();
  const finish = () => {
    ghost.remove();
    el.classList.remove('placeholder');
    document.documentElement.classList.remove('is-dragging');
    for (const s of STATUS_KEYS) columns[s].list.classList.remove('drop-target');
    drag = null;
    if (Object.keys(patch).length) {
      if (patch.status === 'done') celebrate(el);
      updateCard(id, patch);
    } else if (renderPending) {
      renderBoard();
    }
    renderPending = false;
  };
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);

  ghost.classList.remove('lifted');
  ghost.classList.add('dropping');
  ghost.style.setProperty('--dx', `${target.left - drag.rect.left}px`);
  ghost.style.setProperty('--dy', `${target.top - drag.rect.top}px`);
  if (reducedMotion()) finish();
  else {
    ghost.addEventListener('transitionend', finish, { once: true });
    setTimeout(() => drag && drag.ghost === ghost && finish(), 450);
  }
}

/** A tiny burst of confetti dots when something is finished. */
export function celebrate(anchor) {
  if (reducedMotion() || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const colors = ['green', 'blue', 'orange', 'pink', 'yellow', 'purple'];
  for (let i = 0; i < 14; i++) {
    const dot = h('span.confetti', { style: { background: `var(--${colors[i % colors.length]})`, left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } });
    document.body.append(dot);
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 50 + Math.random() * 50;
    dot.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(.4)`, opacity: 0 },
    ], { duration: 650 + Math.random() * 250, easing: SPRING }).onfinish = () => dot.remove();
  }
}
