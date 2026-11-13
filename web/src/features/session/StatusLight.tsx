import { useEffect, useRef } from 'react';
import type { Light } from '../../services/hub/types';
import { Icon } from '../../ui/Icon';
import { gsap, motionAllowed } from '../../ui/motion/gsap';
import { LIGHTS } from './roster';

// Only the lights that need attention pulse, so a calm room stays calm
const PULSING: readonly Light[] = ['needs_help', 'drifting'];

/** A coloured status with an icon and a label, so it is not only colour that carries the meaning. */
export function StatusLight({ light, large = false }: { light: Light; large?: boolean }) {
  const meta = LIGHTS[light];
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ring.current;
    if (!el || !PULSING.includes(light) || !motionAllowed()) return undefined;
    const tween = gsap.fromTo(el, { scale: 1, autoAlpha: 0.7 }, { scale: 2.6, autoAlpha: 0, duration: light === 'needs_help' ? 1.1 : 1.8, ease: 'power1.out', repeat: -1 });
    return () => {
      tween.kill();
    };
  }, [light]);

  return (
    <span className={`inline-flex items-center gap-2 rounded-full font-semibold ${meta.tint} ${meta.text} ${large ? 'px-3.5 py-1.5 text-base' : 'px-2.5 py-1 text-xs'}`}>
      <span className="relative inline-grid place-items-center" aria-hidden="true">
        <span ref={ring} className={`absolute inset-0 rounded-full opacity-0 ${meta.dot}`} />
        <span className={`relative inline-block rounded-full ${meta.dot} ${large ? 'h-3 w-3' : 'h-2.5 w-2.5'}`} />
      </span>
      <Icon name={meta.icon} />
      {meta.label}
    </span>
  );
}
