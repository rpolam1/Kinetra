import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useLiveSnapshot } from '../../app/hooks/useHubStream';
import type { LiveParticipant } from '../../services/hub/types';
import { initialsOf } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { gsap, motionAllowed } from '../../ui/motion/gsap';
import { ProgressBar } from '../../ui/motion/ProgressBar';
import { useRise } from '../../ui/motion/useRise';
import { MAX_PER_PAGE, densityFor, paginate, planGrid } from './boardLayout';
import type { Density } from './boardLayout';
import { prescriptionLine, progressFraction, progressLabel } from './roster';

const GAP = 14;
const PAGE_SECONDS = 12;

function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function useClock(): string {
  const format = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const [time, setTime] = useState(format);
  useEffect(() => {
    const id = window.setInterval(() => setTime(format()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

export function BoardPage() {
  const { snapshot, state } = useLiveSnapshot();
  const root = useRef<HTMLElement>(null);
  const [stage, size] = useElementSize<HTMLDivElement>();
  const clock = useClock();
  useRise(root);

  const active = snapshot?.session?.active === true;
  const people = useMemo(() => (active ? snapshot!.participants : []), [active, snapshot]);
  const pages = useMemo(() => paginate(people, MAX_PER_PAGE), [people]);
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? [];

  useEffect(() => {
    if (pages.length <= 1) {
      setPageIndex(0);
      return undefined;
    }
    const id = window.setInterval(() => setPageIndex((i) => (i + 1) % pages.length), PAGE_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [pages.length]);

  const plan = useMemo(() => planGrid(page.length || 1, size.width, size.height, GAP), [page.length, size.width, size.height]);
  const density = densityFor(page.length);
  const ready = size.width > 0 && size.height > 0;

  return (
    <main ref={root} className="paper flex h-screen cursor-none flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header data-rise className="ink-surface flex shrink-0 items-center justify-between gap-6 px-8 py-4 text-white shadow-[0_6px_24px_-12px_rgb(7_17_15/0.6)]">
        <div className="flex items-center gap-5">
          <Logo height={38} />
          <span aria-hidden="true" className="h-8 w-px bg-white/20" />
          <div>
            <p className="eyebrow flex items-center gap-2 text-teal-300">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${active ? 'animate-pulse bg-teal-300' : 'bg-ink-300'}`} />
              {active ? 'Live now' : 'Waiting'}
            </p>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Today&apos;s exercises</h1>
          </div>
        </div>
        <div className="flex items-center gap-6 text-ink-100">
          {state !== 'open' ? (
            <span role="status" className="flex items-center gap-2 text-lg text-amber-300">
              <Icon name="spinner" spin /> Reconnecting…
            </span>
          ) : null}
          {pages.length > 1 ? (
            <span className="flex items-center gap-2" aria-label={`Page ${Math.min(pageIndex, pages.length - 1) + 1} of ${pages.length}`}>
              {pages.map((_, i) => (
                <span key={i} className={`h-2.5 rounded-full transition-all duration-500 ${i === Math.min(pageIndex, pages.length - 1) ? 'w-8 bg-teal-300' : 'w-2.5 bg-white/25'}`} />
              ))}
            </span>
          ) : null}
          {people.length > 0 ? (
            <span className="flex items-center gap-2 text-xl tabular-nums">
              <Icon name="patients" className="text-ink-300" /> {people.length}
            </span>
          ) : null}
          <span className="text-[2rem] font-semibold tabular-nums leading-none text-white">{clock}</span>
        </div>
      </header>

      <div ref={stage} className="relative mx-6 mb-6 mt-5 min-h-0 flex-1">
        {people.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center">
            <div data-rise className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white px-10 py-8 shadow-card">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-teal-50 text-3xl text-teal-700">
                <Icon name={snapshot ? 'resting' : 'spinner'} spin={!snapshot} />
              </span>
              <p className="text-3xl font-semibold text-slate-800">{snapshot ? 'No session is running right now.' : 'Connecting…'}</p>
            </div>
          </div>
        ) : ready ? (
          <ul aria-label="Everyone's exercise" className="flex h-full flex-wrap content-center items-center justify-center" style={{ gap: GAP }}>
            {page.map((p) => (
              <BoardTile key={p.patient_id} person={p} width={plan.tileWidth} height={plan.tileHeight} density={density} />
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}

function BoardTile({ person, width, height, density }: { person: LiveParticipant; width: number; height: number; density: Density }) {
  const { exercise, progress } = person;
  const tile = useRef<HTMLLIElement>(null);
  const lastIndex = useRef<number | null>(null);
  const index = exercise?.index ?? -1;

  // ring of light when someone moves to a new exercise
  useEffect(() => {
    const el = tile.current;
    const previous = lastIndex.current;
    lastIndex.current = index;
    if (!el || previous === null || previous === index || !motionAllowed()) return;
    gsap.fromTo(el, { boxShadow: '0 0 0 4px rgba(111,213,190,0.95)' }, { boxShadow: '0 0 0 0px rgba(111,213,190,0)', duration: 1.4, ease: 'power2.out', clearProps: 'boxShadow' });
  }, [index]);

  const finished = !exercise;
  const avatar = 'min(15cqh, 11cqw)';

  return (
    <li
      ref={tile}
      data-rise
      style={{ width, height, containerType: 'size' }}
      className={`relative flex-none overflow-hidden rounded-[3cqmin] border shadow-card ${finished ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-white'}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${finished ? 'bg-teal-600' : 'bg-teal-500'}`} style={{ width: '1.8cqmin' }} />
      <div className="flex h-full flex-col justify-between" style={{ padding: '5cqmin 6cqmin 5cqmin 8cqmin' }}>
        <div className="min-h-0">
          <div className="flex items-center" style={{ gap: '2.6cqw' }}>
            <span
              aria-hidden="true"
              className={`board-avatar grid shrink-0 place-items-center rounded-full font-semibold ${finished ? 'bg-teal-600 text-white' : 'bg-teal-100 text-teal-900'}`}
              style={{ width: avatar, height: avatar, fontSize: 'min(5.8cqh, 4.4cqw)' }}
            >
              {initialsOf(person.board_name)}
            </span>
            <h2 className="min-w-0 truncate font-semibold text-slate-900" style={{ fontSize: 'min(7.4cqw, 14cqh)', lineHeight: 1.1 }}>
              {person.board_name}
            </h2>
          </div>
          {exercise ? (
            <>
              <p key={exercise.name} data-rise className="font-bold leading-[1.08] text-teal-800" style={{ marginTop: '3cqh', fontSize: 'min(8.8cqw, 17cqh)', display: '-webkit-box', WebkitLineClamp: density === 'dense' ? 2 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {exercise.name}
              </p>
              <p className="board-optional inline-block rounded-full bg-slate-100 font-medium text-slate-700" style={{ marginTop: '2cqh', padding: '0.8cqh 2.4cqw', fontSize: 'min(4.8cqw, 9cqh)' }}>
                {prescriptionLine(exercise)}
              </p>
            </>
          ) : (
            <p className="flex items-center font-bold text-teal-800" style={{ marginTop: '4cqh', gap: '2cqw', fontSize: 'min(8.4cqw, 16cqh)' }}>
              <Icon name="finished" /> All done. Great work!
            </p>
          )}
        </div>
        {exercise ? (
          <div>
            <div className="flex items-baseline justify-between text-slate-500" style={{ gap: '2cqw', fontSize: 'min(4.9cqw, 9.5cqh)' }}>
              <span className="font-semibold text-slate-900">{progressLabel(exercise, progress)}</span>
              <span className="board-extra truncate text-right">{exercise.next ? `Next: ${exercise.next}` : 'Last exercise'}</span>
            </div>
            <ProgressBar value={progressFraction(exercise, progress)} label={`${person.board_name} progress`} className="mt-[1.8cqh]" heightClassName="h-[3cqh] min-h-[6px]" trackClassName="bg-slate-200" barClassName="bg-teal-500" />
          </div>
        ) : null}
      </div>
    </li>
  );
}
