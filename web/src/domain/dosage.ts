import { getExercise } from './exercises';
import type {
  CardioBlock,
  ExerciseCategory,
  ExerciseDefinition,
  PatientData,
  PrescribedExercise,
} from './types';

export const DOSE_GUIDELINES = {
  sets: { min: 1, max: 2 },
  reps: { min: 10, max: 20 },
  warmupMin: { min: 3, max: 5 },
  cooldownMin: { min: 3, max: 5 },
  cardioMainMin: { min: 15, max: 30 },
  cardioIntensityPct: { low: 40, high: 60 },
  progressionReps: 20,
  rotationSessions: 12,
} as const;

export function estimateMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export interface HeartRateZone {
  restingHr: number;
  maxHr: number;
  maxHrSource: 'measured' | 'estimated';
  reserve: number;
  lowBpm: number;
  highBpm: number;
}

export function heartRateZone(input: {
  age: number | null;
  restingHr: number | null;
  maxHr: number | null;
  lowPct: number;
  highPct: number;
}): HeartRateZone | null {
  const { age, restingHr, maxHr, lowPct, highPct } = input;
  if (restingHr === null) return null;
  const measured = maxHr !== null;
  const max = measured ? maxHr : age !== null ? estimateMaxHr(age) : null;
  if (max === null || max <= restingHr) return null;
  const reserve = max - restingHr;
  return {
    restingHr,
    maxHr: max,
    maxHrSource: measured ? 'measured' : 'estimated',
    reserve,
    lowBpm: Math.round(restingHr + (lowPct / 100) * reserve),
    highBpm: Math.round(restingHr + (highPct / 100) * reserve),
  };
}

export function hasBetaBlocker(patient: Pick<PatientData, 'medications'>): boolean {
  return patient.medications.some((m) => m.betaBlocker);
}

export interface Slot {
  id: string;
  label: string;
  category: ExerciseCategory;
  min: number;
}

export const SESSION_SLOTS: readonly Slot[] = [
  { id: 'mobility', label: 'Mobility', category: 'mobility', min: 2 },
  { id: 'squat_lunge', label: 'Squat / Lunge', category: 'squat_lunge', min: 1 },
  { id: 'push', label: 'Push', category: 'push', min: 1 },
  { id: 'hinge', label: 'Hinge', category: 'hinge', min: 1 },
  { id: 'pull', label: 'Pull', category: 'pull', min: 1 },
  { id: 'carry', label: 'Carry', category: 'carry', min: 1 },
  { id: 'core', label: 'Core', category: 'core', min: 1 },
  { id: 'stretch', label: 'Stretches', category: 'stretch', min: 1 },
];

export interface SlotStatus {
  slot: Slot;
  have: number;
  met: boolean;
}

function categoryOf(exerciseId: string): ExerciseCategory | undefined {
  return getExercise(exerciseId)?.category;
}

export function checkSlots(exercises: readonly PrescribedExercise[]): SlotStatus[] {
  return SESSION_SLOTS.map((slot) => {
    const have = exercises.filter((e) => categoryOf(e.exerciseId) === slot.category).length;
    return { slot, have, met: have >= slot.min };
  });
}

export const STRETCH_TARGETS = [
  'quads',
  'hamstrings',
  'glutes',
  'hip flexors',
  'calf',
  'chest',
  'upper back',
] as const;
export type StretchTarget = (typeof STRETCH_TARGETS)[number];

const STRETCH_TARGET_BY_EXERCISE: Readonly<Record<string, StretchTarget>> = {
  quad_stretch: 'quads',
  hamstring_stretch: 'hamstrings',
  glute_stretch: 'glutes',
  hip_flexor_stretch: 'hip flexors',
  calf_stretch: 'calf',
  chest_doorway_stretch: 'chest',
  upper_back_stretch: 'upper back',
};

export function stretchCoverage(exercises: readonly PrescribedExercise[]): {
  covered: StretchTarget[];
  missing: StretchTarget[];
} {
  const covered = new Set<StretchTarget>();
  for (const e of exercises) {
    const target = STRETCH_TARGET_BY_EXERCISE[e.exerciseId];
    if (target) covered.add(target);
  }
  return {
    covered: STRETCH_TARGETS.filter((t) => covered.has(t)),
    missing: STRETCH_TARGETS.filter((t) => !covered.has(t)),
  };
}

export function doseWarnings(item: PrescribedExercise, def: ExerciseDefinition): string[] {
  const out: string[] = [];
  const { sets, reps } = DOSE_GUIDELINES;
  if (item.sets < sets.min || item.sets > sets.max) {
    out.push(`${item.sets} sets is outside the usual ${sets.min}-${sets.max}`);
  }
  if ((def.tracking === 'scored' || def.tracking === 'count_only') && item.reps !== null) {
    if (item.reps < reps.min || item.reps > reps.max) {
      out.push(`${item.reps} reps is outside the usual ${reps.min}-${reps.max}`);
    }
  }
  if (def.tracking === 'timed' && (item.seconds === null || item.seconds <= 0)) {
    out.push('Set a hold time in seconds');
  }
  return out;
}

export function cardioWarnings(cardio: CardioBlock): string[] {
  const out: string[] = [];
  const { warmupMin, cooldownMin, cardioMainMin } = DOSE_GUIDELINES;
  if (cardio.warmupMin < warmupMin.min || cardio.warmupMin > warmupMin.max) {
    out.push(`Warm-up is usually ${warmupMin.min}-${warmupMin.max} minutes`);
  }
  if (cardio.mainMin < cardioMainMin.min || cardio.mainMin > cardioMainMin.max) {
    out.push(`Main cardio is usually ${cardioMainMin.min}-${cardioMainMin.max} minutes`);
  }
  if (cardio.cooldownMin < cooldownMin.min || cardio.cooldownMin > cooldownMin.max) {
    out.push(`Cool-down is usually ${cooldownMin.min}-${cooldownMin.max} minutes`);
  }
  if (cardio.intensityLowPct >= cardio.intensityHighPct) {
    out.push('Intensity range: low must be below high');
  }
  return out;
}

export function suitabilityWarnings(
  patient: Pick<PatientData, 'mobilityAid' | 'fallsRisk' | 'supervision'>,
  def: ExerciseDefinition,
): string[] {
  const out: string[] = [];
  const upright = def.position === 'standing' || def.position === 'wall';
  if (patient.mobilityAid === 'wheelchair' && def.position !== 'seated') {
    out.push('Patient uses a wheelchair: choose a seated option or record a modification');
  }
  if ((patient.mobilityAid === 'walker' || patient.mobilityAid === 'cane') && def.position === 'floor') {
    out.push('Floor exercise for someone who uses a walker/cane: check they can get down and up');
  }
  if (patient.fallsRisk === 'high' && (upright || def.position === 'floor') && patient.supervision !== 'one_to_one') {
    out.push('High falls risk: arrange support or a volunteer for this exercise');
  }
  return out;
}

export function shouldProgress(
  goodRepsPerSession: readonly number[],
  target: number = DOSE_GUIDELINES.progressionReps,
): boolean {
  if (goodRepsPerSession.length < 2) return false;
  return goodRepsPerSession.slice(-2).every((n) => n >= target);
}

export function sessionsUntilRotation(completedSessions: number): number {
  const block = DOSE_GUIDELINES.rotationSessions;
  if (completedSessions <= 0) return block;
  const rem = completedSessions % block;
  return rem === 0 ? 0 : block - rem;
}
