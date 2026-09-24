// Card tile shared by the board and lists.
import { h, icon, avatarStack } from './ui.js';
import { state, memberById, boardById, STATUS } from './state.js';
import { today, diffDays, formatRange } from './dates.js';

export function dueTone(card) {
  if (card.status === 'done') return 'done';
  const end = card.due || card.start;
  if (!end) return '';
  const diff = diffDays(today(), end);
  if (card.due && diff < 0) return 'overdue';
  if (diff <= 1) return 'soon';
  return '';
}

function signature(card) {
  const board = boardById(card.boardId);
  const people = card.assignees.map((id) => {
    const m = memberById(id);
    return m ? `${m.name}:${m.color}` : '';
  });
  return JSON.stringify([card.title, card.status, card.start, card.due, card.color, card.notes ? 1 : 0,
    card.checklist.map((i) => i.done), people, state.boardId === 'all' && state.boards.length > 1 ? `${board?.emoji}${board?.name}` : '', today()]);
}

function fill(el, card) {
  const board = boardById(card.boardId);
  const done = card.status === 'done';
  const children = [];
  if (card.color) children.push(h('span.card-accent', { style: { background: `var(--${card.color})` } }));
  if (state.boardId === 'all' && state.boards.length > 1 && board) {
    children.push(h('div.card-board', `${board.emoji} ${board.name}`));
  }
  children.push(h('div.card-title', done ? icon('checkCircle', 'card-done-icon') : null, h('span', card.title)));

  const meta = [];
  const range = formatRange(card.start, card.due);
  if (range) {
    const tone = dueTone(card);
    meta.push(h(`span.chip${tone ? `.${tone}` : ''}`, icon(tone === 'overdue' ? 'flag' : 'clock'), range));
  }
  if (card.checklist.length) {
    const doneCount = card.checklist.filter((i) => i.done).length;
    const complete = doneCount === card.checklist.length;
    meta.push(h(`span.chip${complete ? '.done' : ''}`, icon('list'), `${doneCount}/${card.checklist.length}`));
  }
  if (card.notes) meta.push(h('span.chip.plain', icon('note')));
  const people = card.assignees.map(memberById).filter(Boolean);
  if (meta.length || people.length) {
    children.push(h('div.card-meta', meta, h('span.spacer'), people.length ? avatarStack(people, 22) : null));
  }
  el.replaceChildren(...children);
  el.classList.toggle('is-done', done);
  el.setAttribute('aria-label', `${card.title}, ${STATUS[card.status].label}`);
}

export function cardTile(card) {
  const el = h('div.card', { tabIndex: 0, role: 'button' });
  el.dataset.id = card.id;
  el.dataset.flip = card.id;
  el._sig = signature(card);
  fill(el, card);
  return el;
}

export function updateCardTile(el, card) {
  const sig = signature(card);
  if (sig === el._sig) return;
  el._sig = sig;
  fill(el, card);
}
