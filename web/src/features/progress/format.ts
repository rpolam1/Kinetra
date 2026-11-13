import type { ExerciseProgress, MetricChange, WeekPoint } from '../../domain';
import { formatPercent } from '../../domain';

// Formatters for each metric, used by both the screen charts and the printed report
export const fmtDegrees = (v: number): string => `${Math.round(v)}°`;
export const fmtSeconds = (v: number): string => `${v.toFixed(1)} s`;
export const fmtRate = (v: number): string => `${Math.round(v * 100)}%`;
export const fmtCount = (v: number): string => `${Math.round(v)}`;
export const fmtScore = (v: number): string => `${Math.round(v)}`;

/** Describes one metric on the progress charts, including whether a rise is good or bad. */
export interface MetricSpec {
  key: keyof MetricChange;
  title: string;
  pick: (w: WeekPoint) => number | null;
  format: (v: number) => string;
  min?: number;
  max?: number;
  // Null means the direction has no good or bad meaning, such as tempo
  higherIsBetter: boolean | null;
  unit: string;
}

// The metrics shown for exercises that count reps
export const REP_METRICS: readonly MetricSpec[] = [
  { key: 'avgRom', title: 'Range of motion', pick: (w) => w.avgRom, format: fmtDegrees, higherIsBetter: true, unit: 'deg' },
  { key: 'goodRate', title: 'Good-rep rate', pick: (w) => w.goodRate, format: fmtRate, min: 0, max: 1, higherIsBetter: true, unit: '%' },
  { key: 'avgRepSeconds', title: 'Tempo (seconds per rep)', pick: (w) => w.avgRepSeconds, format: fmtSeconds, higherIsBetter: null, unit: 's' },
];

// The metrics shown for timed holds
export const HOLD_METRICS: readonly MetricSpec[] = [
  { key: 'bestHoldSeconds', title: 'Longest hold', pick: (w) => w.bestHoldSeconds, format: fmtSeconds, min: 0, higherIsBetter: true, unit: 's' },
  { key: 'avgHoldSeconds', title: 'Average hold', pick: (w) => w.avgHoldSeconds, format: fmtSeconds, min: 0, higherIsBetter: true, unit: 's' },
  { key: 'holdsCompleted', title: 'Holds completed', pick: (w) => w.holdsCompleted, format: fmtCount, min: 0, higherIsBetter: true, unit: '' },
];

/** Picks the metric set that fits the exercise. */
export function metricsFor(ex: Pick<ExerciseProgress, 'timed'>): readonly MetricSpec[] {
  return ex.timed ? HOLD_METRICS : REP_METRICS;
}

/** Turns a change between the first and latest week into words, with a sign. */
export function describeChange(spec: MetricSpec, delta: number | null): string {
  if (delta === null) return 'not enough data';
  if (spec.key === 'goodRate') return `${delta >= 0 ? '+' : '-'}${Math.round(Math.abs(delta) * 100)} points`;
  if (spec.key === 'holdsCompleted') return `${delta >= 0 ? '+' : '-'}${Math.abs(Math.round(delta))} per week`;
  if (spec.key === 'bestHoldSeconds' || spec.key === 'avgHoldSeconds') return `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} s`;
  if (spec.key === 'avgRepSeconds') return `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} s per rep`;
  return `${delta >= 0 ? '+' : '-'}${Math.round(Math.abs(delta))}°`;
}

/** The badge colour for a change. Neutral metrics and no change stay grey. */
export function changeTone(spec: MetricSpec, delta: number | null): 'green' | 'amber' | 'slate' {
  if (delta === null || spec.higherIsBetter === null || delta === 0) return 'slate';
  return delta > 0 === spec.higherIsBetter ? 'green' : 'amber';
}

// Re exported so the report files only need to import from here
export { formatPercent };
