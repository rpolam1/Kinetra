import { formatWeek } from '../../domain';

export interface TrendChartProps<T extends { weekStart: number }> {
  title: string;
  weeks: readonly T[];
  pick: (w: T) => number | null;
  format: (v: number) => string;
  min?: number;
  max?: number;
  color?: string;
}

const WIDTH = 320;
const HEIGHT = 150;
const PAD = { left: 44, right: 12, top: 12, bottom: 28 };

export function TrendChart<T extends { weekStart: number }>({ title, weeks, pick, format, min, max, color = '#0f766e' }: TrendChartProps<T>) {
  const values = weeks.map(pick);
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return (
      <figure className="rounded-lg border border-slate-200 p-3">
        <figcaption className="text-sm font-medium text-slate-800">{title}</figcaption>
        <p className="mt-6 text-center text-sm text-slate-500">No data yet</p>
      </figure>
    );
  }
  const lo0 = Math.min(...present);
  const hi0 = Math.max(...present);
  const span = hi0 - lo0 || Math.max(Math.abs(hi0) * 0.2, 1);
  const lo = min ?? lo0 - span * 0.15;
  const hi = max ?? hi0 + span * 0.15;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (weeks.length === 1 ? innerW / 2 : (i / (weeks.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const points = values.flatMap((v, i) => (v === null ? [] : [{ x: x(i), y: y(v), v, i }]));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const summary = `${title}: ${format(first.v)} in the week of ${formatWeek(weeks[first.i]!.weekStart)}, ${format(last.v)} in the week of ${formatWeek(weeks[last.i]!.weekStart)}`;

  return (
    <figure className="rounded-lg border border-slate-200 p-3">
      <figcaption className="text-sm font-medium text-slate-800">{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className="mt-1 h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#475569">{format(t)}</text>
          </g>
        ))}
        {points.length > 1 ? <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /> : null}
        {points.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r="3.5" fill={color} />
        ))}
        <text x={x(0)} y={HEIGHT - 8} textAnchor={weeks.length === 1 ? 'middle' : 'start'} fontSize="10" fill="#475569">{formatWeek(weeks[0]!.weekStart)}</text>
        {weeks.length > 1 ? (
          <text x={x(weeks.length - 1)} y={HEIGHT - 8} textAnchor="end" fontSize="10" fill="#475569">{formatWeek(weeks[weeks.length - 1]!.weekStart)}</text>
        ) : null}
      </svg>
    </figure>
  );
}
