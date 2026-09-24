// Dates are stored as local "YYYY-MM-DD" strings, so string comparison == date comparison.

export const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
export const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

const pad = (n) => String(n).padStart(2, '0');

export function toIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toIso(new Date());
}

export function addDays(iso, days) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

export function diffDays(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}

/** Monday-based weekday index 0..6 */
export function weekdayMon(iso) {
  return (parseIso(iso).getDay() + 6) % 7;
}

export function formatShort(iso) {
  const d = parseIso(iso);
  const t = new Date();
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === t.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatLong(iso) {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function formatRelativeDay(iso) {
  const diff = diffDays(today(), iso);
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  if (diff === -1) return 'Wczoraj';
  if (diff > 1 && diff < 7) return WEEKDAYS[parseIso(iso).getDay()];
  return formatShort(iso);
}

export function formatRange(start, due) {
  if (start && due && start !== due) {
    const a = parseIso(start);
    const b = parseIso(due);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return `${a.getDate()}–${formatShort(due)}`;
    }
    return `${formatShort(start)} – ${formatShort(due)}`;
  }
  const one = due || start;
  return one ? formatRelativeDay(one) : '';
}

export function timeAgo(isoDateTime) {
  const s = Math.max(0, (Date.now() - Date.parse(isoDateTime)) / 1000);
  if (s < 45) return 'przed chwilą';
  if (s < 3600) return `${Math.round(s / 60)} min temu`;
  if (s < 86400) return `${Math.round(s / 3600)} godz. temu`;
  const day = toIso(new Date(isoDateTime));
  const diff = diffDays(day, today());
  if (diff === 1) return 'wczoraj';
  if (diff < 7) return `${diff} dni temu`;
  return formatShort(day);
}

/** Card's date span on the calendar, or null when it has no dates. */
export function cardSpan(card) {
  const start = card.start || card.due;
  const end = card.due || card.start;
  return start ? { start, end } : null;
}
