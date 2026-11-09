import { DOSE_GUIDELINES, shouldProgress } from './dosage';
import type { ExerciseResult, PatientSession } from './sessions';

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
  holdAttempts: number;
  holdsCompleted: number;
  bestHoldSeconds: number | null;
  avgHoldSeconds: number | null;
}

export interface MetricChange {
  goodRate: number | null;
  avgScore: number | null;
  avgRom: number | null;
  avgRepSeconds: number | null;
  bestHoldSeconds: number | null;
  holdsCompleted: number | null;
  avgHoldSeconds: number | null;
}

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  timed: boolean;
  sessions: number;
  reps: number;
  holdAttempts: number;
  holdsCompleted: number;
  weeks: WeekPoint[];
  change: MetricChange | null;
  readyToProgress: boolean;
  goodRepsLastTwo: number[];
}

export interface HeartWeek {
  weekStart: number;
  sessions: number;
  avgBpm: number | null;
  peakBpm: number | null;
  inZoneRate: number | null;
}

export interface HeartProgress {
  sessions: number;
  avgBpm: number | null;
  peakBpm: number | null;
  inZoneRate: number | null;
  belowRate: number | null;
  aboveRate: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  weeks: HeartWeek[];
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
  heart: HeartProgress | null;
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
  timed: boolean;
  holdAttempts: number;
  holdsCompleted: number;
  bestHold: number | null;
  avgHold: number | null;
}

function bestOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.max(...present) : null;
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
    holdAttempts: entries.reduce((n, e) => n + e.holdAttempts, 0),
    holdsCompleted: entries.reduce((n, e) => n + e.holdsCompleted, 0),
    bestHoldSeconds: bestOf(entries.map((e) => e.bestHold)),
    avgHoldSeconds: round(weightedMean(entries.map((e) => ({ value: e.avgHold, weight: e.holdAttempts }))), 1),
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

function hasActivity(e: ExerciseResult): boolean {
  return e.reps > 0 || (e.holdAttempts ?? 0) > 0;
}

function entriesOf(sessions: readonly PatientSession[], exerciseId?: string): Entry[] {
  const out: Entry[] = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (!hasActivity(e)) continue;
      if (exerciseId !== undefined && e.exerciseId !== exerciseId) continue;
      out.push({
        sessionId: s.id,
        at: s.startedAt,
        reps: e.reps,
        good: e.good,
        avgScore: e.avgScore,
        avgRom: e.avgRom ?? null,
        avgRepSeconds: e.avgRepSeconds ?? null,
        timed: e.tracking === 'timed',
        holdAttempts: e.holdAttempts ?? 0,
        holdsCompleted: e.holdsCompleted ?? 0,
        bestHold: e.bestHoldSeconds ?? null,
        avgHold: e.avgHoldSeconds ?? null,
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
    bestHoldSeconds: difference(first.bestHoldSeconds, last.bestHoldSeconds, 1),
    holdsCompleted: first.holdsCompleted === 0 && last.holdsCompleted === 0 ? null : last.holdsCompleted - first.holdsCompleted,
    avgHoldSeconds: difference(first.avgHoldSeconds, last.avgHoldSeconds, 1),
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
    timed: entries.some((e) => e.timed),
    sessions: perSession.size,
    reps: entries.reduce((n, e) => n + e.reps, 0),
    holdAttempts: entries.reduce((n, e) => n + e.holdAttempts, 0),
    holdsCompleted: entries.reduce((n, e) => n + e.holdsCompleted, 0),
    weeks,
    change: changeBetween(weeks),
    readyToProgress: shouldProgress(goodPerSession, DOSE_GUIDELINES.progressionReps),
    goodRepsLastTwo: goodPerSession.slice(-2),
  };
}

function zoneShares(sessions: readonly PatientSession[]): { inZone: number | null; below: number | null; above: number | null } {
  let inZone = 0;
  let below = 0;
  let above = 0;
  for (const s of sessions) {
    const h = s.heart;
    if (!h || h.secondsInZone === null || h.secondsBelow === null || h.secondsAbove === null) continue;
    inZone += h.secondsInZone;
    below += h.secondsBelow;
    above += h.secondsAbove;
  }
  const total = inZone + below + above;
  if (total <= 0) return { inZone: null, below: null, above: null };
  return { inZone: round(inZone / total, 3), below: round(below / total, 3), above: round(above / total, 3) };
}

export function heartProgress(sessions: readonly PatientSession[]): HeartProgress | null {
  const withHeart = sessions.filter((s) => s.heart && s.heart.samples > 0);
  if (withHeart.length === 0) return null;
  const byWeek = new Map<number, PatientSession[]>();
  for (const s of withHeart) {
    const key = weekStart(s.startedAt);
    byWeek.set(key, [...(byWeek.get(key) ?? []), s]);
  }
  const weeks: HeartWeek[] = [...byWeek]
    .sort((a, b) => a[0] - b[0])
    .map(([start, list]) => ({
      weekStart: start,
      sessions: list.length,
      avgBpm: round(weightedMean(list.map((s) => ({ value: s.heart!.avgBpm, weight: s.heart!.secondsTotal || 1 }))), 0),
      peakBpm: Math.max(...list.map((s) => s.heart!.maxBpm)),
      inZoneRate: zoneShares(list).inZone,
    }));
  const shares = zoneShares(withHeart);
  const latest = [...withHeart].sort((a, b) => b.startedAt - a.startedAt).find((s) => s.heart!.zoneLow !== null);
  return {
    sessions: withHeart.length,
    avgBpm: round(weightedMean(withHeart.map((s) => ({ value: s.heart!.avgBpm, weight: s.heart!.secondsTotal || 1 }))), 0),
    peakBpm: Math.max(...withHeart.map((s) => s.heart!.maxBpm)),
    inZoneRate: shares.inZone,
    belowRate: shares.below,
    aboveRate: shares.above,
    zoneLow: latest?.heart!.zoneLow ?? null,
    zoneHigh: latest?.heart!.zoneHigh ?? null,
    weeks,
  };
}

export function buildProgressReport(sessions: readonly PatientSession[], maxExercises = 8): ProgressReport {
  const counted = sessions.filter((s) => s.exercises.some(hasActivity));
  const entries = entriesOf(counted);
  const weeks = bucket(entries);
  const scored = entries.filter((e) => e.avgScore !== null);
  const scoredReps = scored.reduce((n, e) => n + e.reps, 0);
  const names = new Map<string, { name: string; reps: number; last: number }>();
  for (const s of counted) {
    for (const e of s.exercises) {
      if (!hasActivity(e)) continue;
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
    heart: heartProgress(counted),
    exercises: ranked.map(([id, info]) => exerciseProgress(counted, id, info.name)),
  };
}

export function formatWeek(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
