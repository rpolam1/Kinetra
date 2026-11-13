import { useLayoutEffect, useRef } from 'react';
import { Link } from '../app/router';
import { gsap, motionAllowed } from './motion/gsap';

export interface TabItem {
  id: string;
  label: string;
  to: string;
}

/** Tabs with an underline that slides to the active tab. */
export function TabNav({ tabs, activeId, label }: { tabs: readonly TabItem[]; activeId: string; label: string }) {
  const nav = useRef<HTMLElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = Math.max(0, tabs.findIndex((t) => t.id === activeId));

  useLayoutEffect(() => {
    const root = nav.current;
    const bar = line.current;
    if (!root || !bar) return undefined;
    const place = () => {
      const link = root.querySelectorAll<HTMLElement>('a[data-tab]')[index];
      if (!link) return;
      const target = { x: link.offsetLeft, width: link.offsetWidth };
      if (!placed.current || !motionAllowed()) {
        gsap.set(bar, target);
        placed.current = true;
      } else {
        gsap.to(bar, { ...target, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
      }
    };
    place();
    // The line is placed again when the layout changes size
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [index, tabs.length]);

  return (
    <nav ref={nav} aria-label={label} data-rise className="relative flex gap-1 overflow-x-auto border-b border-slate-200 scroll-thin">
      {tabs.map((t) => (
        <Link
          key={t.id}
          to={t.to}
          data-tab
          aria-current={t.id === activeId ? 'page' : undefined}
          className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${t.id === activeId ? 'text-teal-800' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {t.label}
        </Link>
      ))}
      <span ref={line} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-t-full bg-teal-600" />
    </nav>
  );
}
