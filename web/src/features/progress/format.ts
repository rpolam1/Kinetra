import type { MetricChange, WeekPoint } from '../../domain';
import { formatPercent } from '../../domain';

export const fmtDegrees = (v: number): string => `${Math.round(v)}°`;
export const fmtSeconds = (v: number): string => `${v.toFixed(1)} s`;
export const fmtRate = (v: number): string => `${Math.round(v * 100)}%`;
export const fmtScore = (v: number): string => `${Math.round(v)}`;

export interface MetricSpec {
  key: keyof MetricChange;
  title: string;
  pick: (w: WeekPoint) => number | null;
  format: (v: number) => string;
  min?: number;
  max?: number;
  higherIsBetter: boolean | null;
  unit: string;
}

export const METRICS: readonly MetricSpec[] = [
  { key: 'avgRom', title: 'Range of motion', pick: (w) => w.avgRom, format: fmtDegrees, higherIsBetter: true, unit: 'deg' },
  { key: 'goodRate', title: 'Good-rep rate', pick: (w) => w.goodRate, format: fmtRate, min: 0, max: 1, higherIsBetter: true, unit: '%' },
  { key: 'avgRepSeconds', title: 'Tempo (seconds per rep)', pick: (w) => w.avgRepSeconds, format: fmtSeconds, higherIsBetter: null, unit: 's' },
];

export function describeChange(spec: MetricSpec, delta: number | null): string {
  if (delta === null) return 'not enough data';
  if (spec.key === 'goodRate') return `${delta >= 0 ? '+' : '-'}${Math.round(Math.abs(delta) * 100)} points`;
  if (spec.key === 'avgRepSeconds') return `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} s per rep`;
  return `${delta >= 0 ? '+' : '-'}${Math.round(Math.abs(delta))}°`;
}

export function changeTone(spec: MetricSpec, delta: number | null): 'green' | 'amber' | 'slate' {
  if (delta === null || spec.higherIsBetter === null || delta === 0) return 'slate';
  return delta > 0 === spec.higherIsBetter ? 'green' : 'amber';
}

export { formatPercent };