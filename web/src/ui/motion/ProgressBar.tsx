import { useLayoutEffect, useRef } from 'react';
import { gsap, motionAllowed } from './gsap';

interface ProgressBarProps {
  value: number;
  label: string;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
  heightClassName?: string;
}

export function ProgressBar({ value, label, className = '', trackClassName = 'bg-slate-200', barClassName = 'bg-teal-600', heightClassName = 'h-1.5' }: ProgressBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    if (!motionAllowed()) {
      el.style.width = `${pct}%`;
      return;
    }
    gsap.to(el, { width: `${pct}%`, duration: 0.7, ease: 'power3.out', overwrite: 'auto' });
  }, [pct]);

  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className={`${heightClassName} w-full overflow-hidden rounded-full ${trackClassName} ${className}`}>
      <div ref={bar} className={`h-full rounded-full ${barClassName}`} style={{ width: 0 }} />
    </div>
  );
}
