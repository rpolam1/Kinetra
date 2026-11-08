import { getExercise } from '../../domain';
import type { Patient, Prescription } from '../../domain';
import type { Light, LiveParticipant, LiveProgress, PlanItem, SessionParticipantInput } from '../../services/hub/types';
import type { IconName } from '../../ui/icons';

export function planFromPrescription(prescription: Prescription): PlanItem[] {
  const plan: PlanItem[] = [];
  for (const e of prescription.exercises) {
    const def = getExercise(e.exerciseId);
    if (!def) continue; // removed from the library, skip it
    const rep = def.tracking === 'scored' || def.tracking === 'count_only';
    plan.push({
      exercise_id: def.id,
      name: def.name,
      tracking: def.tracking,
      sets: e.sets,
      reps: rep || def.tracking === 'manual' ? e.reps : null,
      seconds: def.tracking === 'timed' ? e.seconds : null,
      load: e.load,
      modification: e.modification,
    });
  }
  return plan;
}

export interface RosterProblem {
  blocking: boolean;
  text: string;
}

export function rosterProblems(patient: Patient, prescription: Prescription | null, uncalibrated: readonly string[]): RosterProblem[] {
  const problems: RosterProblem[] = [];
  if (patient.status === 'archived') problems.push({ blocking: true, text: 'Archived' });
  if (!patient.consent.cameraTracking) problems.push({ blocking: true, text: 'No camera-tracking consent recorded' });
  if (!prescription || planFromPrescription(prescription).length === 0) problems.push({ blocking: true, text: 'No prescription yet' });
  if (uncalibrated.length > 0) {
    problems.push({ blocking: false, text: `Not calibrated: ${uncalibrated.join(', ')} (reps will be counted, not scored)` });
  }
  return problems;
}

export function toParticipantInput(patient: Patient, prescription: Prescription): SessionParticipantInput {
  return { patient_id: patient.code, board_name: patient.boardName, plan: planFromPrescription(prescription) };
}

export interface LightMeta {
  label: string;
  dot: string;
  stripe: string;
  tint: string;
  text: string;
  icon: IconName;
  priority: number;
}

export const LIGHTS: Readonly<Record<Light, LightMeta>> = {
  needs_help: { label: 'Needs help', dot: 'bg-red-600', stripe: 'border-l-red-600', tint: 'bg-red-100', text: 'text-red-900', icon: 'warning', priority: 0 },
  drifting: { label: 'Form drifting', dot: 'bg-amber-500', stripe: 'border-l-amber-500', tint: 'bg-amber-100', text: 'text-amber-900', icon: 'trend', priority: 1 },
  not_detected: { label: 'Not detected', dot: 'bg-slate-400', stripe: 'border-l-slate-400', tint: 'bg-slate-200', text: 'text-slate-800', icon: 'camera', priority: 2 },
  resting: { label: 'Resting', dot: 'bg-sky-500', stripe: 'border-l-sky-500', tint: 'bg-sky-100', text: 'text-sky-900', icon: 'resting', priority: 3 },
  on_track: { label: 'On track', dot: 'bg-emerald-600', stripe: 'border-l-emerald-600', tint: 'bg-emerald-100', text: 'text-emerald-900', icon: 'check', priority: 4 },
  finished: { label: 'Finished', dot: 'bg-teal-700', stripe: 'border-l-teal-700', tint: 'bg-teal-100', text: 'text-teal-900', icon: 'finished', priority: 5 },
};

export function sortByNeed<T extends Pick<LiveParticipant, 'light'>>(people: readonly T[]): T[] {
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => LIGHTS[a.p.light].priority - LIGHTS[b.p.light].priority || a.i - b.i)
    .map((x) => x.p);
}

export function countByLight(people: readonly Pick<LiveParticipant, 'light'>[]): Record<Light, number> {
  const counts: Record<Light, number> = { needs_help: 0, drifting: 0, not_detected: 0, resting: 0, on_track: 0, finished: 0 };
  for (const p of people) counts[p.light] += 1;
  return counts;
}

export function progressLabel(exercise: NonNullable<LiveParticipant['exercise']>, progress: LiveProgress | null): string {
  if (exercise.tracking === 'timed') return `${exercise.sets} × ${exercise.seconds ?? '?'} s`;
  if (!progress) return `${exercise.sets} sets`;
  if (exercise.reps === null) return `Set ${progress.set_number} of ${exercise.sets}`;
  return `Set ${progress.set_number} of ${exercise.sets} · ${progress.current_set_reps} of ${exercise.reps} reps`;
}

export function progressFraction(exercise: NonNullable<LiveParticipant['exercise']>, progress: LiveProgress | null): number {
  if (!progress || exercise.sets <= 0) return 0;
  const completedSets = Math.max(0, progress.set_number - 1);
  const inSet = exercise.tracking !== 'timed' && exercise.reps ? Math.min(1, progress.current_set_reps / exercise.reps) : 0;
  return Math.min(1, (completedSets + inSet) / exercise.sets);
}

export function prescriptionLine(exercise: NonNullable<LiveParticipant['exercise']>): string {
  const amount = exercise.tracking === 'timed' ? `${exercise.sets} × ${exercise.seconds ?? '?'} s` : exercise.reps ? `${exercise.sets} × ${exercise.reps}` : `${exercise.sets} sets`;
  const extras = [exercise.load, exercise.modification ? `(${exercise.modification})` : ''].filter(Boolean);
  return [amount, ...extras].join(', ').replace(', (', ' (');
}
