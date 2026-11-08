import { DOSE_GUIDELINES } from './dosage';
import type {
  CardioBlock,
  ExerciseDefinition,
  PrescribedExercise,
  PrescriptionContent,
} from './types';

export function defaultCardio(): CardioBlock {
  return {
    machine: 'recumbent_bike',
    warmupMin: 5,
    mainMin: 20,
    cooldownMin: 5,
    intensityLowPct: DOSE_GUIDELINES.cardioIntensityPct.low,
    intensityHighPct: DOSE_GUIDELINES.cardioIntensityPct.high,
    notes: '',
  };
}

export function emptyContent(): PrescriptionContent {
  return { exercises: [], cardio: defaultCardio() };
}

export function newPrescribedExercise(def: ExerciseDefinition): PrescribedExercise {
  const rep = def.tracking === 'scored' || def.tracking === 'count_only';
  return {
    exerciseId: def.id,
    sets: def.defaultSets,
    reps: rep ? (def.defaultReps ?? 10) : null,
    seconds: def.defaultSeconds ?? null,
    load: '',
    modification: '',
    notes: '',
    progression: rep ? 'twenty_reps_two_sessions' : 'manual',
  };
}

function sameExercise(a: PrescribedExercise, b: PrescribedExercise): boolean {
  return (
    a.sets === b.sets &&
    a.reps === b.reps &&
    a.seconds === b.seconds &&
    a.load === b.load &&
    a.modification === b.modification &&
    a.notes === b.notes &&
    a.progression === b.progression
  );
}

function sameCardio(a: CardioBlock, b: CardioBlock): boolean {
  return (
    a.machine === b.machine &&
    a.warmupMin === b.warmupMin &&
    a.mainMin === b.mainMin &&
    a.cooldownMin === b.cooldownMin &&
    a.intensityLowPct === b.intensityLowPct &&
    a.intensityHighPct === b.intensityHighPct &&
    a.notes === b.notes
  );
}

export function contentEquals(a: PrescriptionContent, b: PrescriptionContent): boolean {
  return (
    sameCardio(a.cardio, b.cardio) &&
    a.exercises.length === b.exercises.length &&
    a.exercises.every((e, i) => e.exerciseId === b.exercises[i]?.exerciseId && sameExercise(e, b.exercises[i]!))
  );
}

export interface ContentDiff {
  added: string[];
  removed: string[];
  changed: string[];
  reordered: boolean;
  cardioChanged: boolean;
}

export function diffContent(prev: PrescriptionContent | null, next: PrescriptionContent): ContentDiff {
  const before = new Map((prev?.exercises ?? []).map((e) => [e.exerciseId, e]));
  const after = new Map(next.exercises.map((e) => [e.exerciseId, e]));
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter(
    (id) => before.has(id) && !sameExercise(before.get(id)!, after.get(id)!),
  );
  const keptBefore = (prev?.exercises ?? []).map((e) => e.exerciseId).filter((id) => after.has(id));
  const keptAfter = next.exercises.map((e) => e.exerciseId).filter((id) => before.has(id));
  return {
    added,
    removed,
    changed,
    reordered: keptBefore.join('|') !== keptAfter.join('|'),
    cardioChanged: prev ? !sameCardio(prev.cardio, next.cardio) : false,
  };
}

export function describeDiff(diff: ContentDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`${diff.changed.length} changed`);
  if (diff.reordered) parts.push('reordered');
  if (diff.cardioChanged) parts.push('cardio changed');
  return parts.length ? parts.join(', ') : 'no changes';
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved as T);
  return copy;
}
