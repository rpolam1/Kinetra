export interface GridPlan {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export const TILE_ASPECT = 1.7;
const MAX_TILE_WIDTH = 760;
const MAX_TILE_HEIGHT = 440;
export const MAX_PER_PAGE = 30;

export function planGrid(count: number, width: number, height: number, gap: number): GridPlan {
  const n = Math.max(1, Math.floor(count));
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  let best: (GridPlan & { fit: number; spare: number }) | null = null;

  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const tileWidth = (w - gap * (cols - 1)) / cols;
    const tileHeight = (h - gap * (rows - 1)) / rows;
    if (tileWidth <= 0 || tileHeight <= 0) continue;
    // biggest tile of the right shape that fits this cell
    const fit = Math.min(tileWidth, tileHeight * TILE_ASPECT);
    const spare = cols * rows - n;
    const better = best === null || fit > best.fit + 0.5 || (Math.abs(fit - best.fit) <= 0.5 && spare < best.spare);
    if (better) best = { cols, rows, tileWidth, tileHeight, fit, spare };
  }

  const chosen = best ?? { cols: 1, rows: n, tileWidth: w, tileHeight: Math.max(1, h / n), fit: 0, spare: 0 };
  return {
    cols: chosen.cols,
    rows: chosen.rows,
    tileWidth: Math.floor(Math.min(chosen.tileWidth, MAX_TILE_WIDTH)),
    tileHeight: Math.floor(Math.min(chosen.tileHeight, MAX_TILE_HEIGHT)),
  };
}

export function paginate<T>(items: readonly T[], perPage: number = MAX_PER_PAGE): T[][] {
  if (items.length === 0) return [[]];
  const pages = Math.ceil(items.length / perPage);
  const size = Math.ceil(items.length / pages);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type Density = 'roomy' | 'comfy' | 'compact' | 'dense';

export function densityFor(visibleCount: number): Density {
  if (visibleCount <= 6) return 'roomy';
  if (visibleCount <= 12) return 'comfy';
  if (visibleCount <= 20) return 'compact';
  return 'dense';
}
