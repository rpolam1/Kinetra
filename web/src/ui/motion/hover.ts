import { gsap, motionAllowed } from './gsap';

const LIFT_SHADOW = '0 1px 0 rgba(27,26,23,0.04), 0 14px 26px -12px rgba(27,26,23,0.32)';
const REST_SHADOW = '0 1px 0 rgba(27,26,23,0.04), 0 1px 2px rgba(27,26,23,0.04)';

type Kind = 'lift' | 'button' | 'row' | 'nav';

function kindOf(el: HTMLElement): Kind | null {
  const kind = el.dataset.hover;
  return kind === 'lift' || kind === 'button' || kind === 'row' || kind === 'nav' ? kind : null;
}

function isInert(el: HTMLElement): boolean {
  return el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
}

function toParts(el: HTMLElement, selector: string, vars: gsap.TweenVars): void {
  const found = Array.from(el.querySelectorAll<HTMLElement>(selector));
  if (found.length > 0) gsap.to(found, vars);
}

function enter(el: HTMLElement, kind: Kind): void {
  switch (kind) {
    case 'lift':
      gsap.to(el, { y: -3, boxShadow: LIFT_SHADOW, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      toParts(el, '[data-hover-arrow]', { x: 4, duration: 0.3, ease: 'power2.out' });
      break;
    case 'button':
      gsap.to(el, { y: -1, duration: 0.2, ease: 'power2.out', overwrite: 'auto' });
      toParts(el, '[data-hover-icon]', { x: 3, duration: 0.25, ease: 'power2.out' });
      break;
    case 'row':
      toParts(el, '[data-hover-bar]', { scaleY: 1, opacity: 1, duration: 0.28, ease: 'power3.out' });
      toParts(el, '[data-hover-arrow]', { x: 5, duration: 0.28, ease: 'power3.out' });
      break;
    case 'nav':
      toParts(el, '[data-hover-label]', { x: 3, duration: 0.25, ease: 'power2.out' });
      toParts(el, '[data-hover-icon]', { rotate: -8, scale: 1.12, duration: 0.3, ease: 'back.out(2)' });
      break;
  }
}

function leave(el: HTMLElement, kind: Kind): void {
  switch (kind) {
    case 'lift':
      gsap.to(el, { y: 0, boxShadow: REST_SHADOW, duration: 0.35, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform,boxShadow' });
      toParts(el, '[data-hover-arrow]', { x: 0, duration: 0.3, ease: 'power2.out' });
      break;
    case 'button':
      gsap.to(el, { y: 0, scale: 1, duration: 0.25, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform' });
      toParts(el, '[data-hover-icon]', { x: 0, duration: 0.25, ease: 'power2.out' });
      break;
    case 'row':
      toParts(el, '[data-hover-bar]', { scaleY: 0, opacity: 0, duration: 0.25, ease: 'power2.out' });
      toParts(el, '[data-hover-arrow]', { x: 0, duration: 0.25, ease: 'power2.out' });
      break;
    case 'nav':
      toParts(el, '[data-hover-label]', { x: 0, duration: 0.25, ease: 'power2.out' });
      toParts(el, '[data-hover-icon]', { rotate: 0, scale: 1, duration: 0.3, ease: 'power2.out' });
      break;
  }
}

export function installHoverMotion(root: HTMLElement | Document = document): () => void {
  const target = (event: Event): HTMLElement | null => (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hover]') : null);

  const onOver = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType === 'touch' || !motionAllowed()) return;
    const el = target(e);
    const kind = el ? kindOf(el) : null;
    if (!el || !kind || isInert(el)) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    enter(el, kind);
  };

  const onOut = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType === 'touch' || !motionAllowed()) return;
    const el = target(e);
    const kind = el ? kindOf(el) : null;
    if (!el || !kind) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    leave(el, kind);
  };

  const onDown = (event: Event) => {
    if (!motionAllowed()) return;
    const el = target(event);
    if (!el || kindOf(el) !== 'button' || isInert(el)) return;
    gsap.to(el, { scale: 0.96, duration: 0.1, ease: 'power2.out', overwrite: 'auto' });
  };

  const onUp = (event: Event) => {
    if (!motionAllowed()) return;
    const el = target(event);
    if (!el || kindOf(el) !== 'button') return;
    gsap.to(el, { scale: 1, duration: 0.35, ease: 'back.out(3)', overwrite: 'auto' });
  };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
  return () => {
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerout', onOut);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
  };
}
