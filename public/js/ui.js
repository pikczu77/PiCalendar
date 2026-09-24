// Small DOM toolkit: element builder, icons, iOS-like sheets, menus, alerts, toasts and FLIP animations.

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const SPRING = 'cubic-bezier(.32,.72,0,1)';
export const SMOOTH = 'cubic-bezier(.2,.8,.2,1)';

/** h('div.card#x', {onclick}, child, 'text', [more]) — text is always set via textContent. */
export function h(tag, attrs, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list' && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// ---------- icons (SF Symbols-like, stroke based) ----------

const ICONS = {
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.6"/><rect x="9.5" y="4" width="5" height="11" rx="1.6"/><rect x="15.5" y="4" width="5" height="7" rx="1.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  overview: '<path d="M4 20V11M10 20V5M16 20v-6M22 20H2" transform="translate(1 0)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.5"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17" r=".6"/>',
  note: '<path d="M6 4h9l4 4v12H6z"/><path d="M9.5 12h6M9.5 16h4"/>',
  trash: '<path d="M4.5 7h15M10 7V4.8h4V7M6.5 7l1 12.5h9l1-12.5"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 4-6 7.5-6s6.7 2 7.5 6"/>',
  xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
  sparkles: '<path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- avatars ----------

export function initials(name = '?') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function avatar(member, size = 28, extra = '') {
  const el = h(`span.avatar${extra ? `.${extra}` : ''}`, {
    style: { '--size': `${size}px`, '--c': `var(--${member?.color || 'gray'})` },
    title: member?.name || 'Nieznany',
  }, initials(member?.name));
  return el;
}

export function avatarStack(members, size = 22, max = 3) {
  const stack = h('span.avatar-stack');
  members.slice(0, max).forEach((m) => stack.append(avatar(m, size)));
  if (members.length > max) {
    stack.append(h('span.avatar.more', { style: { '--size': `${size}px` } }, `+${members.length - max}`));
  }
  return stack;
}

// ---------- haptic-ish feedback ----------

export function tapFeedback() {
  if (navigator.vibrate) navigator.vibrate(8);
}

// ---------- FLIP ----------

/**
 * Animates keyed elements ([data-flip]) inside `root` from their old to new positions
 * after `mutate()` runs. New elements pop in, removed ones fade out in place.
 */
export function flip(root, mutate, { exclude } = {}) {
  if (reducedMotion()) {
    mutate();
    return;
  }
  const before = new Map();
  for (const el of root.querySelectorAll('[data-flip]')) {
    if (el === exclude) continue;
    before.set(el.dataset.flip, { el, rect: el.getBoundingClientRect() });
  }
  mutate();
  const seen = new Set();
  for (const el of root.querySelectorAll('[data-flip]')) {
    if (el === exclude) continue;
    const key = el.dataset.flip;
    seen.add(key);
    const prev = before.get(key);
    const rect = el.getBoundingClientRect();
    if (!prev) {
      if (rect.width) {
        el.animate([
          { opacity: 0, transform: 'scale(.9)' },
          { opacity: 1, transform: 'none' },
        ], { duration: 420, easing: SPRING });
      }
      continue;
    }
    const dx = prev.rect.left - rect.left;
    const dy = prev.rect.top - rect.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      el.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'none' },
      ], { duration: 460, easing: SPRING });
    }
  }
  for (const [key, { el, rect }] of before) {
    if (seen.has(key) || !rect.width) continue;
    const ghost = el.cloneNode(true);
    ghost.removeAttribute('data-flip');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: 0, pointerEvents: 'none', zIndex: 50,
    });
    document.body.append(ghost);
    ghost.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(.85)' },
    ], { duration: 280, easing: SMOOTH }).onfinish = () => ghost.remove();
  }
}

/** Reuses children keyed by data-key; returns the ordered list of elements. */
export function reconcile(container, items, keyOf, create, update) {
  const existing = new Map();
  for (const child of container.children) {
    if (child.dataset.key) existing.set(child.dataset.key, child);
  }
  const els = items.map((item) => {
    const key = keyOf(item);
    let el = existing.get(key);
    if (el) {
      existing.delete(key);
      update(el, item);
    } else {
      el = create(item);
      el.dataset.key = key;
    }
    return el;
  });
  for (const el of existing.values()) el.remove();
  let prev = null;
  for (const el of els) {
    const expected = prev ? prev.nextElementSibling : container.firstElementChild;
    if (expected !== el) {
      if (prev) prev.after(el);
      else container.prepend(el);
    }
    prev = el;
  }
  return els;
}

// ---------- layers: sheets, menus, alerts ----------

const layers = () => document.getElementById('layers');
const openLayers = [];

function lockApp() {
  const app = document.getElementById('app');
  const sheets = openLayers.filter((l) => l.kind === 'sheet').length;
  const mobile = innerWidth < 720;
  app.classList.toggle('pushed-back', sheets > 0 && mobile);
  if (sheets > 0 && mobile) {
    app.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
  }
  document.documentElement.classList.toggle('modal-open', openLayers.length > 0);
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openLayers.length) {
    const top = openLayers[openLayers.length - 1];
    if (top.dismissible !== false) top.close();
  }
});

/**
 * iOS-style sheet. Slides up on phones (drag the grabber down to dismiss),
 * appears as a centered card on wide screens.
 */
export function openSheet({ title = '', left, right, content, onClose, className = '' }) {
  const backdrop = h('div.backdrop');
  const header = h('div.sheet-header',
    h('div.sheet-grabber'),
    h('div.sheet-bar',
      h('div.sheet-bar-side', left ? navButton(left) : null),
      h('div.sheet-title', title),
      h('div.sheet-bar-side.right', right ? navButton(right) : null)));
  const body = h('div.sheet-body', content);
  const sheet = h(`div.sheet${className ? `.${className}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, header, body);
  const wrap = h('div.layer', backdrop, sheet);
  layers().append(wrap);

  let closed = false;
  const layer = {
    kind: 'sheet',
    el: sheet,
    body,
    setRight(btn) {
      const side = header.querySelector('.sheet-bar-side.right');
      side.replaceChildren(btn ? navButton(btn) : '');
    },
    close(reason) {
      if (closed) return;
      if (onClose && onClose(reason) === false) return;
      closed = true;
      openLayers.splice(openLayers.indexOf(layer), 1);
      lockApp();
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      const done = () => wrap.remove();
      if (reducedMotion()) done();
      else sheet.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 600);
    },
  };
  openLayers.push(layer);
  backdrop.addEventListener('click', () => layer.close('backdrop'));

  requestAnimationFrame(() => {
    lockApp();
    requestAnimationFrame(() => wrap.classList.add('open'));
  });

  enableDragToDismiss(header, sheet, backdrop, () => layer.close('drag'));
  return layer;
}

function navButton({ label, action, bold, disabled, destructive }) {
  const btn = h(`button.nav-btn${bold ? '.bold' : ''}${destructive ? '.destructive' : ''}`, { type: 'button', onclick: action, disabled }, label);
  return btn;
}

function enableDragToDismiss(handle, sheet, backdrop, dismiss) {
  let startY = 0;
  let dy = 0;
  let dragging = false;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (innerWidth >= 720 || e.target.closest('button')) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    dy = 0;
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const raw = e.clientY - startY;
    dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2; // rubber band upwards
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    backdrop.style.opacity = '';
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) dismiss();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** iOS context-menu style popover anchored to an element. */
export function openMenu(anchor, items, { align = 'left' } = {}) {
  const menu = h('div.menu', { role: 'menu' });
  const wrap = h('div.layer.menu-layer', h('div.menu-backdrop'), menu);
  let closed = false;
  const layer = {
    kind: 'menu',
    close() {
      if (closed) return;
      closed = true;
      openLayers.splice(openLayers.indexOf(layer), 1);
      lockApp();
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
    },
  };
  for (const item of items) {
    if (item === '-') {
      menu.append(h('div.menu-sep'));
      continue;
    }
    menu.append(h(`button.menu-item${item.destructive ? '.destructive' : ''}`, {
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        layer.close();
        item.action?.();
      },
    },
    h('span.menu-check', item.checked ? icon('check') : null),
    h('span.menu-label', item.label),
    item.icon ? h('span.menu-icon', typeof item.icon === 'string' ? icon(item.icon) : item.icon) : null));
  }
  wrap.firstChild.addEventListener('pointerdown', () => layer.close());
  layers().append(wrap);
  openLayers.push(layer);
  lockApp();

  const r = anchor.getBoundingClientRect();
  const mw = Math.min(260, innerWidth - 24);
  menu.style.width = `${mw}px`;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(12, Math.min(left, innerWidth - mw - 12));
  const spaceBelow = innerHeight - r.bottom;
  const menuH = Math.min(menu.scrollHeight || items.length * 44, innerHeight * 0.6);
  if (spaceBelow < menuH + 20 && r.top > spaceBelow) {
    menu.style.bottom = `${innerHeight - r.top + 8}px`;
    menu.style.transformOrigin = `${align === 'right' ? '90%' : '10%'} 100%`;
  } else {
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.transformOrigin = `${align === 'right' ? '90%' : '10%'} 0%`;
  }
  menu.style.left = `${left}px`;
  requestAnimationFrame(() => wrap.classList.add('open'));
  return layer;
}

/** iOS alert. Resolves with the chosen button's value (or the input text for prompts). */
export function alertDialog({ title, message, buttons, input }) {
  return new Promise((resolve) => {
    let field = null;
    const box = h('div.alert', { role: 'alertdialog', 'aria-label': title },
      h('div.alert-text',
        h('div.alert-title', title),
        message ? h('div.alert-message', message) : null,
        input ? (field = h('input.alert-input', {
          type: 'text',
          value: input.value || '',
          placeholder: input.placeholder || '',
          maxLength: input.maxLength || 60,
          enterkeyhint: 'done',
        })) : null),
      h(`div.alert-buttons${buttons.length > 2 ? '.stacked' : ''}`, buttons.map((b) => h(`button.alert-btn${b.bold ? '.bold' : ''}${b.destructive ? '.destructive' : ''}`, {
        type: 'button',
        onclick: () => finish(b.value === undefined ? true : b.value),
      }, b.label))));
    const wrap = h('div.layer.alert-layer', h('div.backdrop'), box);
    const layer = {
      kind: 'alert',
      close: () => finish(null),
    };
    function finish(value) {
      if (!openLayers.includes(layer)) return;
      openLayers.splice(openLayers.indexOf(layer), 1);
      lockApp();
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 250);
      if (value === 'input') value = field.value.trim() || null;
      resolve(value);
    }
    if (field) {
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish('input');
      });
    }
    layers().append(wrap);
    openLayers.push(layer);
    lockApp();
    requestAnimationFrame(() => {
      wrap.classList.add('open');
      field?.focus();
      field?.select();
    });
  });
}

export function confirmDialog({ title, message, confirmLabel = 'OK', destructive = false }) {
  return alertDialog({
    title,
    message,
    buttons: [
      { label: 'Anuluj', value: false },
      { label: confirmLabel, value: true, bold: !destructive, destructive },
    ],
  }).then((v) => v === true);
}

export function promptDialog({ title, message, value, placeholder, confirmLabel = 'Zapisz', maxLength }) {
  return alertDialog({
    title,
    message,
    input: { value, placeholder, maxLength },
    buttons: [
      { label: 'Anuluj', value: null },
      { label: confirmLabel, value: 'input', bold: true },
    ],
  });
}

// ---------- toasts ----------

export function toast(content, { tone = 'default', duration = 3200 } = {}) {
  const host = document.getElementById('toasts');
  const el = h(`div.toast.${tone}`, content);
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  const hide = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  };
  el.addEventListener('click', hide);
  setTimeout(hide, duration);
}

// ---------- segmented control ----------

export function segmented(options, value, onChange, { compact = false } = {}) {
  const thumb = h('span.seg-thumb');
  const root = h(`div.segmented${compact ? '.compact' : ''}`, { role: 'tablist' }, thumb);
  const buttons = options.map((opt) => {
    const btn = h('button.seg-btn', {
      type: 'button',
      role: 'tab',
      onclick: () => {
        if (root.dataset.value === opt.value) return;
        set(opt.value);
        onChange(opt.value);
      },
    }, opt.dot ? h('span.dot', { style: { background: `var(--${opt.dot})` } }) : null, opt.label);
    btn.dataset.value = opt.value;
    root.append(btn);
    return btn;
  });
  function set(v) {
    root.dataset.value = v;
    const i = Math.max(0, options.findIndex((o) => o.value === v));
    buttons.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    root.style.setProperty('--i', i);
    root.style.setProperty('--n', options.length);
  }
  set(value);
  root.set = set;
  return root;
}
