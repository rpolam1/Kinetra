import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { todayIso } from '../domain';
import { FieldFrame, inputClass } from './fields';
import { Icon } from './Icon';
import { gsap, motionAllowed } from './motion/gsap';
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  YEARS_PER_PAGE,
  addDays,
  addMonths,
  clampIso,
  formatLong,
  isOutOfRange,
  monthGrid,
  normalizeTyped,
  parseIso,
  toIso,
  yearPageStart,
} from './calendar';

type View = 'days' | 'months' | 'years';

/** Start view years suits dates far in the past, such as a date of birth. Anchor year sets where the list of years opens. */
export interface DatePickerProps {
  label: string;
  name: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  startView?: 'days' | 'years';
  anchorYear?: number;
}

// Fixed sizes let the calendar be placed before it has been measured
const POPOVER_WIDTH = 304;
const POPOVER_HEIGHT = 372;

/** A date field that can be typed in or picked from a calendar. The value is a YYYY-MM-DD string, or empty. */
export function DatePicker({ label, name, value, onChange, min, max, error, hint, required, disabled, startView = 'days', anchorYear }: DatePickerProps) {
  const id = useId();
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  // sync the typed text when the value changes from outside
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commitTyped = (text: string) => {
    setDraft(text);
    const normalized = normalizeTyped(text);
    const parsed = parseIso(normalized);
    if (text.trim() === '') onChange('');
    else if (parsed && !isOutOfRange(normalized, min, max)) onChange(normalized);
    else onChange(parsed ? normalized : ''); // out of range still goes up so validation can say why
  };

  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <FieldFrame id={id} label={label} error={error} hint={hint} required={required}>
      <div ref={field} className="relative">
        <input
          id={id}
          data-field={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            setDraft(value);
          }}
          onChange={(e) => commitTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={`${inputClass(error)} pr-11 tabular-nums`}
        />
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-label={`Open calendar for ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-hover="button"
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-teal-700 disabled:opacity-40"
        >
          <span data-hover-icon className="inline-flex"><Icon name="calendar" /></span>
        </button>
        {open ? (
          <CalendarPopover
            label={label}
            anchor={field}
            value={value}
            today={today}
            min={min}
            max={max}
            startView={startView}
            anchorYear={anchorYear}
            onPick={(iso) => {
              setDraft(iso);
              onChange(iso);
              setOpen(false);
              trigger.current?.focus();
            }}
            onClear={() => {
              setDraft('');
              onChange('');
              setOpen(false);
              trigger.current?.focus();
            }}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            ignore={trigger}
          />
        ) : null}
      </div>
    </FieldFrame>
  );
}

interface PopoverProps {
  label: string;
  anchor: RefObject<HTMLDivElement | null>;
  ignore: RefObject<HTMLButtonElement | null>;
  value: string;
  today: string;
  min?: string;
  max?: string;
  startView: 'days' | 'years';
  anchorYear?: number;
  onPick: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** The calendar. It is drawn in a portal with fixed positioning, so a parent that hides overflow cannot clip it. Arrow keys move by day and week, the page keys move by month, and Shift with them moves by year. */
function CalendarPopover({ label, anchor, ignore, value, today, min, max, startView, anchorYear, onPick, onClear, onClose }: PopoverProps) {
  const root = useRef<HTMLDivElement>(null);
  const parsedValue = parseIso(value);
  const fallbackIso = clampIso(anchorYear !== undefined ? toIso(anchorYear, 0, 1) : today, min, max);
  const [cursor, setCursor] = useState(parsedValue ? value : fallbackIso);
  const [view, setView] = useState<View>(!parsedValue && startView === 'years' ? 'years' : 'days');
  // Focus only follows the highlighted day after a key press, so using the month arrows with the mouse does not move it
  const [keyboard, setKeyboard] = useState(true);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const cur = parseIso(cursor) ?? parseIso(fallbackIso)!;

  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    // The calendar opens above the field when there is no room below it
    const below = rect.bottom + 6;
    const top = below + POPOVER_HEIGHT > window.innerHeight && rect.top - POPOVER_HEIGHT - 6 > 0 ? rect.top - POPOVER_HEIGHT - 6 : below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPos({ left, top });
  }, [anchor]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  useEffect(() => {
    if (root.current && motionAllowed()) gsap.fromTo(root.current, { opacity: 0, y: -6, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'power2.out' });
  }, []);

  // A click outside the calendar closes it, but clicks on the field or its button are left to those controls
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (root.current?.contains(target) || anchor.current?.contains(target) || ignore.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, ignore, onClose]);

  // keep focus on the highlighted day while arrowing
  useEffect(() => {
    if (view !== 'days' || !keyboard) return;
    root.current?.querySelector<HTMLElement>(`[data-iso="${cursor}"]`)?.focus();
  }, [cursor, view, keyboard]);

  const disabledDay = (iso: string) => isOutOfRange(iso, min, max);
  const minYear = min ? (parseIso(min)?.year ?? 1) : 1;
  const maxYear = max ? (parseIso(max)?.year ?? 9999) : 9999;

  const moveCursor = (iso: string) => {
    setKeyboard(true);
    setCursor(clampIso(iso, min, max));
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, string> = {
      ArrowLeft: addDays(cursor, -1),
      ArrowRight: addDays(cursor, 1),
      ArrowUp: addDays(cursor, -7),
      ArrowDown: addDays(cursor, 7),
      PageUp: addMonths(cursor, e.shiftKey ? -12 : -1),
      PageDown: addMonths(cursor, e.shiftKey ? 12 : 1),
    };
    const next = step[e.key];
    if (next) {
      e.preventDefault();
      moveCursor(next);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const shiftMonth = (delta: number) => {
    setKeyboard(false);
    setCursor(clampIso(addMonths(cursor, delta), min, max));
  };

  const pageStart = yearPageStart(cur.year);
  const selectYear = (year: number) => {
    setKeyboard(false);
    // The day is capped at 28 so that every month has it
    setCursor(clampIso(toIso(year, cur.month, Math.min(cur.day, 28)), min, max));
    setView('months');
  };
  const selectMonth = (monthIndex: number) => {
    setKeyboard(true);
    setCursor(clampIso(toIso(cur.year, monthIndex, Math.min(cur.day, 28)), min, max));
    setView('days');
  };

  const heading =
    view === 'days' ? `${MONTH_NAMES[cur.month]} ${cur.year}` : view === 'months' ? String(cur.year) : `${pageStart} - ${pageStart + YEARS_PER_PAGE - 1}`;
  const prevDisabled = view === 'days' ? cur.year <= minYear && cur.month === 0 : view === 'months' ? cur.year <= minYear : pageStart <= minYear;
  const nextDisabled = view === 'days' ? cur.year >= maxYear && cur.month === 11 : view === 'months' ? cur.year >= maxYear : pageStart + YEARS_PER_PAGE > maxYear;

  const goPrev = () => {
    setKeyboard(false);
    if (view === 'days') shiftMonth(-1);
    else if (view === 'months') setCursor(clampIso(toIso(cur.year - 1, cur.month, Math.min(cur.day, 28)), min, max));
    else setCursor(clampIso(toIso(Math.max(1, pageStart - YEARS_PER_PAGE), cur.month, 1), min, max));
  };
  const goNext = () => {
    setKeyboard(false);
    if (view === 'days') shiftMonth(1);
    else if (view === 'months') setCursor(clampIso(toIso(cur.year + 1, cur.month, Math.min(cur.day, 28)), min, max));
    else setCursor(clampIso(toIso(pageStart + YEARS_PER_PAGE, cur.month, 1), min, max));
  };

  const cellBase = 'grid place-items-center rounded-lg text-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-300';

  const body = (
    <div
      ref={root}
      role="dialog"
      aria-label={`Choose ${label.toLowerCase()}`}
      onKeyDown={onKey}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH, zIndex: 60 }}
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_-12px_rgb(27_26_23/0.35)]"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={goPrev} disabled={prevDisabled} aria-label={view === 'days' ? 'Previous month' : view === 'months' ? 'Previous year' : 'Earlier years'} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30">
          <Icon name="previous" />
        </button>
        <button
          type="button"
          onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
          aria-label={view === 'days' ? `${heading}, choose month and year` : view === 'months' ? `${heading}, choose year` : 'Back to the calendar'}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-slate-900 transition-colors hover:bg-slate-100"
        >
          {heading}
          {view !== 'years' ? <Icon name="expand" className="text-xs text-slate-500" /> : null}
        </button>
        <button type="button" onClick={goNext} disabled={nextDisabled} aria-label={view === 'days' ? 'Next month' : view === 'months' ? 'Next year' : 'Later years'} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-30">
          <Icon name="next" />
        </button>
      </div>

      {view === 'days' ? (
        <div role="group" aria-label={heading} onKeyDown={onGridKey}>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d} className="py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {monthGrid(cur.year, cur.month).map((cell) => {
              const selected = cell.iso === value;
              const isToday = cell.iso === today;
              const off = disabledDay(cell.iso);
              return (
                <button
                  key={cell.iso}
                  type="button"
                  data-iso={cell.iso}
                  aria-pressed={selected}
                  aria-label={formatLong(cell.iso)}
                  aria-current={isToday ? 'date' : undefined}
                  disabled={off}
                  tabIndex={cell.iso === cursor ? 0 : -1}
                  onClick={() => onPick(cell.iso)}
                  className={`${cellBase} h-9 ${
                    selected
                      ? 'bg-teal-600 font-semibold text-white hover:bg-teal-700'
                      : `${cell.inMonth ? 'text-slate-800' : 'text-slate-400'} hover:bg-teal-50 hover:text-teal-800 ${isToday ? 'font-semibold ring-1 ring-inset ring-teal-500' : ''}`
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === 'months' ? (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {MONTH_NAMES.map((m, i) => {
            const monthStart = toIso(cur.year, i, 1);
            const monthEnd = toIso(cur.year, i, 28);
            const off = (min !== undefined && min !== '' && monthEnd < min) || (max !== undefined && max !== '' && monthStart > max);
            const selected = parsedValue?.year === cur.year && parsedValue.month === i;
            return (
              <button key={m} type="button" disabled={off} onClick={() => selectMonth(i)} className={`${cellBase} h-12 ${selected ? 'bg-teal-600 font-semibold text-white' : 'text-slate-800 hover:bg-teal-50 hover:text-teal-800'}`}>
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : null}

      {view === 'years' ? (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: YEARS_PER_PAGE }, (_, i) => pageStart + i).map((y) => {
            const off = y < minYear || y > maxYear || y < 1;
            const selected = parsedValue?.year === y;
            const thisYear = parseIso(today)?.year === y;
            return (
              <button key={y} type="button" disabled={off} onClick={() => selectYear(y)} className={`${cellBase} h-12 tabular-nums ${selected ? 'bg-teal-600 font-semibold text-white' : `text-slate-800 hover:bg-teal-50 hover:text-teal-800 ${thisYear ? 'ring-1 ring-inset ring-teal-500' : ''}`}`}>
                {y}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <button
          type="button"
          disabled={disabledDay(today)}
          onClick={() => onPick(today)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:text-slate-300"
        >
          Today
        </button>
        {value ? (
          <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
