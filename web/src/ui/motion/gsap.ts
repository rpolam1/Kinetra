import { gsap } from 'gsap';

// Re-exported so every animation imports GSAP from one place
export { gsap };

/** False when the person has asked their system for reduced motion. Animations are skipped in that case. */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
