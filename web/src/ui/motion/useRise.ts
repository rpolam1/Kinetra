import { useEffect } from 'react';
import type { RefObject } from 'react';
import { gsap, motionAllowed } from './gsap';

/** Fade and lift elements marked with data-rise when they first appear inside the root, including ones added later. Each element plays once. */
export function useRise(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const seen = new WeakSet<Element>();

    const collect = (node: Node, into: HTMLElement[]) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches('[data-rise]')) into.push(node);
      node.querySelectorAll<HTMLElement>('[data-rise]').forEach((el) => into.push(el));
    };

    const play = (found: HTMLElement[]) => {
      const fresh = found.filter((el) => el.isConnected && !seen.has(el));
      if (fresh.length === 0) return;
      for (const el of fresh) seen.add(el);
      if (!motionAllowed()) return;
      gsap.fromTo(
        fresh,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.55,
          ease: 'power3.out',
          stagger: Math.min(0.05, 0.7 / fresh.length),
          clearProps: 'opacity,visibility,transform',
        },
      );
    };

    const initial: HTMLElement[] = [];
    collect(root, initial);
    play(initial);

    const observer = new MutationObserver((mutations) => {
      const found: HTMLElement[] = [];
      for (const m of mutations) m.addedNodes.forEach((n) => collect(n, found));
      play(found);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [rootRef]);
}
