/** A function that returns a number from 0 up to but not including 1. */
export type Random = () => number;

/** A small seeded generator (mulberry32). The same seed always gives the same demo data, so reruns are predictable. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moves from one value to another by a fraction p. */
export const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

/** Keeps a value between a low and a high limit. */
export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** A random offset between minus spread and plus spread. */
export const jitter = (random: Random, spread: number): number => (random() - 0.5) * 2 * spread;

/** Rounds to a number of decimal places. */
export const roundTo = (value: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};