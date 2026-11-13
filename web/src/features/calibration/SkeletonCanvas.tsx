import { useEffect, useRef } from 'react';
import type { Landmark } from '../../services/hub/types';
import { drawSkeleton } from './skeleton';
import type { Palette } from './skeleton';

const PALETTE: Palette = { bone: '#6cbfae', joint: '#f8f6f1', background: '#0b1a20' };
// The canvas has a fixed drawing size and the page scales it, so line widths stay in proportion
const BASE_WIDTH = 640;

/** Draws a skeleton from normalised landmarks. The aspect ratio is limited to a sensible range, so a bad value from the hub cannot make a huge or flat canvas. */
export function SkeletonCanvas({ landmarks, aspect, label, className = '' }: { landmarks: readonly Landmark[] | null; aspect: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const safeAspect = aspect > 0.2 && aspect < 5 ? aspect : 4 / 3;
  const width = BASE_WIDTH;
  const height = Math.round(BASE_WIDTH / safeAspect);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawSkeleton(ctx, landmarks, width, height, PALETTE);
  }, [landmarks, width, height]);

  return <canvas ref={ref} width={width} height={height} role="img" aria-label={label} className={`w-full rounded-lg bg-ink-900 ring-1 ring-ink-700 ${className}`} style={{ aspectRatio: String(safeAspect) }} />;
}
