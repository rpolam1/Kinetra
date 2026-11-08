export interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
export const YEARS_PER_PAGE = 12;

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export function parseIso(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  d.setFullYear(year); // years under 100 would be read as 19xx
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return { year, month, day };
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function monthGrid(year: number, monthIndex: number): DayCell[] {
  const first = new Date(year, monthIndex, 1);
  const lead = first.getDay();
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(year, monthIndex, 1 - lead + i);
    cells.push({ iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === monthIndex });
  }
  return cells;
}

export function addDays(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(p.year, p.month, p.day + days);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addMonths(iso: string, months: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const target = p.month + months;
  const year = p.year + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  return toIso(year, month, Math.min(p.day, daysInMonth(year, month)));
}

export function clampIso(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export function isOutOfRange(iso: string, min?: string, max?: string): boolean {
  return (min !== undefined && min !== '' && iso < min) || (max !== undefined && max !== '' && iso > max);
}

export function yearPageStart(year: number): number {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

export function formatLong(iso: string): string {
  const p = parseIso(iso);
  if (!p) return '';
  const weekday = new Date(p.year, p.month, p.day).toLocaleDateString('en-CA', { weekday: 'long' });
  return `${weekday}, ${MONTH_NAMES[p.month]} ${p.day}, ${p.year}`;
}

export function formatShort(iso: string): string {
  const p = parseIso(iso);
  return p ? `${MONTH_NAMES[p.month]!.slice(0, 3)} ${p.day}, ${p.year}` : '';
}

export function normalizeTyped(text: string): string {
  const t = text.trim().replace(/[./\s]+/g, '-');
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}` : t;
}
