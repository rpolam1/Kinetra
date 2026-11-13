import { useLayoutEffect, useRef } from 'react';
import { gsap, motionAllowed } from './gsap';

/** A number that counts up or down to a new value. The first value, and reduced motion, show the number straight away. */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const from = shown.current;
    shown.current = value;
    if (from === null || from === value || !motionAllowed()) {
      el.textContent = String(value);
      return undefined;
    }
    const state = { v: from };
    const tween = gsap.to(state, {
      v: value,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = String(Math.round(state.v));
      },
      onComplete: () => {
        el.textContent = String(value);
      },
    });
    return () => {
      tween.kill();
      el.textContent = String(value);
    };
  }, [value]);

  return <span ref={ref} className={className} />;
}
