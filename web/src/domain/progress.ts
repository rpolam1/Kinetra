import { DOSE_GUIDELINES, shouldProgress } from './dosage';
import type { PatientSession } from './sessions';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_OFFSET_MS = 4 * DAY_MS;

export function weekStart(ms: number): number {
  return Math.floor((ms - MONDAY_OFFSET_MS) / WEEK_MS) * WEEK_MS + MONDAY_OFFSET_MS;
}

export interface WeekPoint {
  weekStart: number;
  sessions: number;
  reps: number;
  scoredReps: number;
  goodReps: number;
  goodRate: number | null;
  avgScore: number | null;
  avgRom: number | null;
  avgRepSeconds: number | null;
}

export interface MetricChange {
  goodRate: number | null;
  avgScore: number | null;
  avgRom: number | null;
  avgRepSeconds: number | null;
}

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  sessions: number;
  reps: number;
  weeks: WeekPoint[];
  change: MetricChange | null;
  readyToProgress: boolean;
  goodRepsLastTwo: number[];
}

export interface ProgressReport {
  from: number | null;
  to: number | null;
  sessionCount: number;
  totalReps: number;
  scoredReps: number;
  goodRate: number | null;
  avgScore: number | null;
  weeks: WeekPoint[];
  exercises: ExerciseProgress[];
}

interface Sample {
  value: number | null | undefined;
  weight: number;
}

function weightedMean(samples: readonly Sample[]): number | null {
  let total = 0;
  let sum = 0;
  for (const s of samples) {
    if (s.value === null || s.value === undefined || !Number.isFinite(s.value) || s.weight <= 0) continue;
    sum += s.value * s.weight;
    total += s.weight;
  }
  return total > 0 ? sum / total : null;
}

function round(value: number | null, places: number): number | null {
  if (value === null) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

interface Entry {
  sessionId: string;
  at: number;
  reps: number;
  good: number;
  avgScore: number | null;
  avgRom: number | null;
  avgRepSeconds: number | null;
}

function toPoint(start: number, entries: readonly Entry[]): WeekPoint {
  const reps = entries.reduce((n, e) => n + e.reps, 0);
  const scored = entries.filter((e) => e.avgScore !== null);
  const scoredReps = scored.reduce((n, e) => n + e.reps, 0);
  const goodReps = scored.reduce((n, e) => n + e.good, 0);
  return {
    weekStart: start,
    sessions: new Set(entries.map((e) => e.sessionId)).size,
    reps,
    scoredReps,
    goodReps,
    goodRate: scoredReps > 0 ? round(goodReps / scoredReps, 3) : null,
    avgScore: round(weightedMean(entries.map((e) => ({ value: e.avgScore, weight: e.reps }))), 1),
    avgRom: round(weightedMean(entries.map((e) => ({ value: e.avgRom, weight: e.reps }))), 1),
    avgRepSeconds: round(weightedMean(entries.map((e) => ({ value: e.avgRepSeconds, weight: e.reps }))), 2),
  };
}

function bucket(entries: readonly Entry[]): WeekPoint[] {
  const byWeek = new Map<number, Entry[]>();
  for (const e of entries) {
    const key = weekStart(e.at);
    byWeek.set(key, [...(byWeek.get(key) ?? []), e]);
  }
  return [...byWeek]
    .sort((a, b) => a[0] - b[0])
    .map(([start, list]) => toPoint(start, list));
}

function entriesOf(sessions: readonly PatientSession[], exerciseId?: string): Entry[] {
  const out: Entry[] = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.reps <= 0) continue;
      if (exerciseId !== undefined && e.exerciseId !== exerciseId) continue;
      out.push({
        sessionId: s.id,
        at: s.startedAt,
        reps: e.reps,
        good: e.good,
        avgScore: e.avgScore,
        avgRom: e.avgRom ?? null,
        avgRepSeconds: e.avgRepSeconds ?? null,
      });
    }
  }
  return out;
}

export function weeklyProgress(sessions: readonly PatientSession[], exerciseId?: string): WeekPoint[] {
  return bucket(entriesOf(sessions, exerciseId));
}

function difference(first: number | null, last: number | null, places: number): number | null {
  if (first === null || last === null) return null;
  return round(last - first, places);
}

export function changeBetween(weeks: readonly WeekPoint[]): MetricChange | null {
  if (weeks.length < 2) return null;
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  return {
    goodRate: difference(first.goodRate, last.goodRate, 3),
    avgScore: difference(first.avgScore, last.avgScore, 1),
    avgRom: difference(first.avgRom, last.avgRom, 1),
    avgRepSeconds: difference(first.avgRepSeconds, last.avgRepSeconds, 2),
  };
}

function exerciseProgress(sessions: readonly PatientSession[], exerciseId: string, name: string): ExerciseProgress {
  const entries = entriesOf(sessions, exerciseId).sort((a, b) => a.at - b.at);
  const weeks = bucket(entries);
  const perSession = new Map<string, number>();
  for (const e of entries) perSession.set(e.sessionId, (perSession.get(e.sessionId) ?? 0) + e.good);
  const goodPerSession = [...perSession.values()];
  return {
    exerciseId,
    name,
    sessions: perSession.size,
    reps: entries.reduce((n, e) => n + e.reps, 0),
    weeks,
    change: changeBetween(weeks),
    readyToProgress: shouldProgress(goodPerSession, DOSE_GUIDELINES.progressionReps),
    goodRepsLastTwo: goodPerSession.slice(-2),
  };
}

export function buildProgressReport(sessions: readonly PatientSession[], maxExercises = 8): ProgressReport {
  const counted = sessions.filter((s) => s.exercises.some((e) => e.reps > 0));
  const entries = entriesOf(counted);
  const weeks = bucket(entries);
  const scored = entries.filter((e) => e.avgScore !== null);
  const scoredReps = scored.reduce((n, e) => n + e.reps, 0);
  const names = new Map<string, { name: string; reps: number; last: number }>();
  for (const s of counted) {
    for (const e of s.exercises) {
      if (e.reps <= 0) continue;
      const known = names.get(e.exerciseId);
      names.set(e.exerciseId, {
        name: known && known.last > s.startedAt ? known.name : e.name,
        reps: (known?.reps ?? 0) + e.reps,
        last: Math.max(known?.last ?? 0, s.startedAt),
      });
    }
  }
  const ranked = [...names]
    .sort((a, b) => b[1].last - a[1].last || b[1].reps - a[1].reps)
    .slice(0, maxExercises);
  return {
    from: counted.length ? Math.min(...counted.map((s) => s.startedAt)) : null,
    to: counted.length ? Math.max(...counted.map((s) => s.endedAt)) : null,
    sessionCount: counted.length,
    totalReps: entries.reduce((n, e) => n + e.reps, 0),
    scoredReps,
    goodRate: scoredReps > 0 ? round(scored.reduce((n, e) => n + e.good, 0) / scoredReps, 3) : null,
    avgScore: round(weightedMean(entries.map((e) => ({ value: e.avgScore, weight: e.reps }))), 1),
    weeks,
    exercises: ranked.map(([id, info]) => exerciseProgress(counted, id, info.name)),
  };
}

export function formatWeek(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}