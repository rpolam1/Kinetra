import type { SessionHeartSummary, SessionSummary } from '../services/hub/types';
import type { TrackingMode } from './types';

/** Results for one exercise in one saved session. The hold and heart rate fields are optional because not every exercise or watch provides them. */
export interface ExerciseResult {
  exerciseId: string;
  name: string;
  tracking: TrackingMode;
  targetSets: number;
  targetReps: number | null;
  reps: number;
  sets: number;
  good: number;
  needsCorrection: number;
  flagged: number;
  avgScore: number | null;
  avgRom?: number | null;
  avgRepSeconds?: number | null;
  holdAttempts?: number;
  holdsCompleted?: number;
  bestHoldSeconds?: number | null;
  avgHoldSeconds?: number | null;
  avgHr?: number | null;
  peakHr?: number | null;
  completed: boolean;
}

/** Heart rate summary for a whole session. The time in zone is null when no target zone was set. */
export interface SessionHeart {
  samples: number;
  avgBpm: number;
  minBpm: number;
  maxBpm: number;
  secondsTotal: number;
  secondsInZone: number | null;
  secondsBelow: number | null;
  secondsAbove: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
}

/** One finished session for one patient, as saved in the database. */
export interface PatientSession {
  id: string;
  patientId: string;
  startedAt: number;
  endedAt: number;
  exercises: ExerciseResult[];
  heart?: SessionHeart | null;
  savedBy: string;
}

/** A record that a patient was calibrated for an exercise on one camera. */
export interface CalibrationRecord {
  slot: string;
  exerciseId: string;
  cameraId: string;
  keptReps: number;
  warnings: string[];
  calibratedAt: number;
  calibratedBy: string;
}

/** Convert the hub's heart rate summary. Returns null when there were no samples. */
export function heartFromSummary(h: SessionHeartSummary | null | undefined): SessionHeart | null {
  if (!h || h.samples <= 0) return null;
  return {
    samples: h.samples,
    avgBpm: h.avg_bpm,
    minBpm: h.min_bpm,
    maxBpm: h.max_bpm,
    secondsTotal: h.seconds_total,
    secondsInZone: h.seconds_in_zone,
    secondsBelow: h.seconds_below,
    secondsAbove: h.seconds_above,
    zoneLow: h.zone?.low ?? null,
    zoneHigh: h.zone?.high ?? null,
  };
}

// The hub reports seconds and the database stores milliseconds
const toMs = (seconds: number): number => Math.round(seconds * 1000);

/** Turn the hub's end of session summary into one saved session per patient. People who are not in the patient list, or who did nothing, are skipped. */
export function sessionsFromSummary(
  summary: SessionSummary,
  idByCode: Readonly<Record<string, string>>,
  actorUid: string,
): PatientSession[] {
  const out: PatientSession[] = [];
  for (const person of summary.participants) {
    const patientId = idByCode[person.patient_id];
    if (!patientId) continue;
    const exercises: ExerciseResult[] = person.exercises.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.name,
      tracking: e.tracking,
      targetSets: e.target_sets,
      targetReps: e.target_reps,
      reps: e.reps,
      sets: e.sets,
      good: e.good,
      needsCorrection: e.needs_correction,
      flagged: e.flagged,
      avgScore: e.avg_score,
      avgRom: e.avg_rom ?? null,
      avgRepSeconds: e.avg_rep_seconds ?? null,
      holdAttempts: e.hold_attempts ?? 0,
      holdsCompleted: e.holds_completed ?? 0,
      bestHoldSeconds: e.best_hold_seconds ?? null,
      avgHoldSeconds: e.avg_hold_seconds ?? null,
      avgHr: e.avg_hr ?? null,
      peakHr: e.peak_hr ?? null,
      completed: e.completed,
    }));
    if (!exercises.some((e) => e.reps > 0 || e.completed || (e.holdAttempts ?? 0) > 0)) continue;
    out.push({
      id: summary.session_id,
      patientId,
      startedAt: toMs(summary.started_at),
      endedAt: toMs(summary.ended_at),
      exercises,
      heart: heartFromSummary(person.heart),
      savedBy: actorUid,
    });
  }
  return out;
}

export interface TrendPoint {
  sessionId: string;
  at: number;
  reps: number;
  avgScore: number | null;
  goodShare: number | null;
}

/** Points for a chart of one exercise over time, oldest first. */
export function exerciseTrend(sessions: readonly PatientSession[], exerciseId: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const s of sessions) {
    const e = s.exercises.find((x) => x.exerciseId === exerciseId && x.reps > 0);
    if (!e) continue;
    points.push({
      sessionId: s.id,
      at: s.startedAt,
      reps: e.reps,
      avgScore: e.avgScore,
      goodShare: e.avgScore === null || e.reps === 0 ? null : e.good / e.reps,
    });
  }
  return points.sort((a, b) => a.at - b.at);
}

/** Exercises the patient has done, named as in their most recent session. */
export function exercisesSeen(sessions: readonly PatientSession[]): { exerciseId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    for (const e of s.exercises) if (e.reps > 0 && !seen.has(e.exerciseId)) seen.set(e.exerciseId, e.name);
  }
  return [...seen].map(([exerciseId, name]) => ({ exerciseId, name }));
}

/** The key a calibration is stored under. Each camera has its own calibration for an exercise, and the hub uses the same naming. */
export function calibrationSlot(exerciseId: string, cameraId: string): string {
  return `${exerciseId}@${cameraId}`;
}

/** A slash would split the document path, so it is replaced to give a valid document id. */
export function slotDocId(slot: string): string {
  return slot.replace(/\//g, '_');
}
