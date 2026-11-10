export type Random = () => number;

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

export const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export const jitter = (random: Random, spread: number): number => (random() - 0.5) * 2 * spread;

export const roundTo = (value: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};