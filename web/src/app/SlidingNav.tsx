import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { AnimatedNumber } from '../ui/motion/AnimatedNumber';
import { gsap, motionAllowed } from '../ui/motion/gsap';
import { Link } from './router';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
}

/** Navigation links with a highlight bar that slides to the active link. The bar jumps into place the first time and when motion is reduced. */
export function SlidingNav({ items, activePath }: { items: readonly NavItem[]; activePath: string }) {
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const activeIndex = items.findIndex((i) => activePath === i.to || activePath.startsWith(`${i.to}/`));

  useLayoutEffect(() => {
    const root = nav.current;
    const bar = indicator.current;
    if (!root || !bar) return undefined;

    const place = () => {
      const link = activeIndex >= 0 ? root.querySelectorAll<HTMLElement>('a[data-nav-link]')[activeIndex] : undefined;
      if (!link) {
        gsap.to(bar, { autoAlpha: 0, duration: 0.2 });
        return;
      }
      const target = { x: link.offsetLeft, y: link.offsetTop, width: link.offsetWidth, height: link.offsetHeight, autoAlpha: 1 };
      if (!placed.current || !motionAllowed()) {
        gsap.set(bar, target);
        placed.current = true;
      } else {
        gsap.to(bar, { ...target, duration: 0.5, ease: 'power3.out', overwrite: 'auto' });
      }
    };

    place();
    // The bar is placed again when the layout changes size
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [activeIndex, items.length]);

  return (
    <nav ref={nav} aria-label="Main" className="relative flex gap-1 lg:flex-col">
      <span ref={indicator} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-lg bg-white/10 opacity-0 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-teal-300" />
      {items.map((item, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={item.to}
            to={item.to}
            data-nav-link
            data-hover="nav"
            aria-current={active ? 'page' : undefined}
            className={`relative z-10 flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'text-white' : 'text-ink-100 hover:text-white'}`}
          >
            <span data-hover-icon className="inline-flex w-5 justify-center text-[15px]"><Icon name={item.icon} /></span>
            <span data-hover-label>{item.label}</span>
            {item.badge ? (
              <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-clay-500 px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`${item.badge} waiting`}>
                <AnimatedNumber value={item.badge} />
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
