import rawLibrary from '../../../config/exercises.json';
import type {
  ExerciseCategory,
  ExerciseDefinition,
  ExercisePosition,
  TrackingMode,
} from './types';

/** An exercise as it is written in config/exercises.json. */
interface RawExercise {
  name: string;
  category: ExerciseCategory;
  tracking: TrackingMode;
  position: ExercisePosition;
  equipment?: string;
  default_sets: number;
  default_reps?: number;
  default_seconds?: number;
}

/** The order categories are shown in. */
export const CATEGORY_ORDER: readonly ExerciseCategory[] = [
  'mobility',
  'squat_lunge',
  'push',
  'hinge',
  'pull',
  'carry',
  'core',
  'stretch',
  'cardio',
];

export const CATEGORY_LABELS: Readonly<Record<ExerciseCategory, string>> = {
  mobility: 'Mobility',
  squat_lunge: 'Squat / Lunge',
  push: 'Push',
  hinge: 'Hinge',
  pull: 'Pull',
  carry: 'Carry',
  core: 'Core',
  stretch: 'Stretch',
  cardio: 'Cardio',
};

export const TRACKING_LABELS: Readonly<Record<TrackingMode, string>> = {
  scored: 'Form scored',
  count_only: 'Reps counted',
  timed: 'Timed hold',
  manual: 'Instructor logs',
};

/** Convert a library entry from snake case to the shape the app uses. */
export function toDefinition(id: string, raw: RawExercise): ExerciseDefinition {
  return {
    id,
    name: raw.name,
    category: raw.category,
    tracking: raw.tracking,
    position: raw.position,
    equipment: raw.equipment,
    defaultSets: raw.default_sets,
    defaultReps: raw.default_reps,
    defaultSeconds: raw.default_seconds,
  };
}

/** Convert the whole library file. */
export function buildLibrary(raw: Record<string, RawExercise>): readonly ExerciseDefinition[] {
  return Object.entries(raw).map(([id, entry]) => toDefinition(id, entry));
}

/** The exercise library. The vision code reads the same file, so both sides use the same ids. */
export const EXERCISES: readonly ExerciseDefinition[] = buildLibrary(
  rawLibrary as unknown as Record<string, RawExercise>,
);

const BY_ID: ReadonlyMap<string, ExerciseDefinition> = new Map(EXERCISES.map((e) => [e.id, e]));

/** Look up an exercise, or undefined when the id is unknown. */
export function getExercise(id: string): ExerciseDefinition | undefined {
  return BY_ID.get(id);
}

/** Look up an exercise and throw when the id is unknown. */
export function requireExercise(id: string): ExerciseDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown exercise id: ${id}`);
  return found;
}

/** Every exercise in one category. */
export function exercisesInCategory(category: ExerciseCategory): ExerciseDefinition[] {
  return EXERCISES.filter((e) => e.category === category);
}

/** Exercises whose name or equipment contains the text, optionally limited to one category. */
export function searchExercises(query: string, category?: ExerciseCategory): ExerciseDefinition[] {
  const q = query.trim().toLowerCase();
  return EXERCISES.filter(
    (e) =>
      (!category || e.category === category) &&
      (q === '' || e.name.toLowerCase().includes(q) || (e.equipment ?? '').toLowerCase().includes(q)),
  );
}

/** Only form scored exercises need a calibration, because they compare each rep with a template. */
export function needsCalibration(exercise: ExerciseDefinition): boolean {
  return exercise.tracking === 'scored';
}
