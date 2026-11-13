import { computeAge, hasBetaBlocker, heartRateZone, requireExercise, weekStart } from '../../src/domain';
import type { ExerciseResult, PatientSession, PrescribedExercise, SessionHeart } from '../../src/domain';
import type { Arc, DemoPerson, Shape } from './cast';
import { clamp, createRandom, jitter, lerp, roundTo } from './random';
import type { Random } from './random';

// Time constants in milliseconds
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// Days of the week used for sessions, as offsets from the Monday that starts the week
const SESSION_DAYS = [1, 3, 5];
// Exercises where the longest hold is the thing that improves
const HOLD_EXERCISES = new Set(['wall_sit', 'plank', 'side_plank']);
// One heart rate sample is assumed about every four seconds
const HR_SECONDS_PER_SAMPLE = 4;

/** The settings for generating a history. */
export interface HistoryOptions {
  weeks: number;
  now: number;
  seed: number;
}

/** Turns a straight line of progress into a curve for the patient's story, such as a fast start or a plateau. */
function shaped(shape: Shape, p: number): number {
  switch (shape) {
    case 'fast':
      return Math.sqrt(p);
    case 'late':
      return p * p;
    case 'plateau':
      return p < 0.55 ? p / 0.55 * 0.8 : 0.8 + (p - 0.55) * 0.2;
    case 'dip':
      return clamp(p - 0.22 * Math.exp(-(((p - 0.45) / 0.09) ** 2)), 0, 1);
    default:
      return p;
  }
}

/** The heart rate zone for a person, from their own prescription. */
function zoneFor(person: DemoPerson) {
  const cardio = person.content.cardio;
  return heartRateZone({
    age: computeAge(person.data.dateOfBirth),
    restingHr: person.data.restingHr,
    maxHr: person.data.maxHr,
    lowPct: cardio.intensityLowPct,
    highPct: cardio.intensityHighPct,
  });
}

/** Makes the heart summary for one session. People on beta blockers get no zone times, as in the real app. */
function heartFor(person: DemoPerson, p: number, seconds: number, random: Random): SessionHeart | null {
  const zone = zoneFor(person);
  if (!zone) return null;
  const arc = person.arc;
  const frac = clamp(lerp(arc.hrFrom, arc.hrTo, p) + jitter(random, 0.04), 0.1, 0.95);
  const avg = zone.restingHr + frac * zone.reserve;
  const min = zone.restingHr + 6 + random() * 6;
  const max = Math.min(zone.maxHr - 3, avg + 14 + random() * 14);
  const base: SessionHeart = {
    samples: Math.round(seconds / HR_SECONDS_PER_SAMPLE),
    avgBpm: Math.round(avg),
    minBpm: Math.round(min),
    maxBpm: Math.round(max),
    secondsTotal: seconds,
    secondsInZone: null,
    secondsBelow: null,
    secondsAbove: null,
    zoneLow: zone.lowBpm,
    zoneHigh: zone.highBpm,
  };
  if (hasBetaBlocker(person.data)) return base;
  const inZone = clamp(lerp(arc.zoneFrom, arc.zoneTo, p) + jitter(random, 0.06), 0.1, 0.92);
  const above = (1 - inZone) * clamp(lerp(0.7, 0.35, p) + jitter(random, 0.1), 0.1, 0.9);
  const below = 1 - inZone - above;
  return {
    ...base,
    secondsInZone: Math.round(seconds * inZone),
    secondsAbove: Math.round(seconds * above),
    secondsBelow: Math.round(seconds * below),
  };
}

/** Makes the result for one exercise in a session. Timed holds, count only and scored exercises each fill in different fields. */
function resultFor(planned: PrescribedExercise, p: number, arc: Arc, heart: SessionHeart | null, random: Random): ExerciseResult {
  const def = requireExercise(planned.exerciseId);
  const avgHr = heart ? Math.round(heart.avgBpm + jitter(random, 5)) : null;
  const peakHr = heart && avgHr !== null ? Math.min(heart.maxBpm, Math.round(avgHr + 8 + random() * 8)) : null;
  const common = {
    exerciseId: def.id,
    name: def.name,
    tracking: def.tracking,
    targetSets: planned.sets,
    targetReps: planned.reps,
    avgHr,
    peakHr,
  };

  if (def.tracking === 'timed') {
    const best = HOLD_EXERCISES.has(def.id)
      ? lerp(arc.holdFrom, arc.holdTo, p)
      : (planned.seconds ?? 30) * lerp(0.75, 1.25, p);
    const attempts = Math.max(planned.sets, Math.round(planned.sets + lerp(2, 0, p) + jitter(random, 0.8)));
    const completed = Math.min(attempts, Math.max(0, Math.round(attempts * clamp(lerp(0.45, 0.95, p) + jitter(random, 0.08), 0.2, 1))));
    const bestHold = roundTo(Math.max(5, best + jitter(random, 3)), 1);
    return {
      ...common,
      reps: completed,
      sets: Math.min(planned.sets, completed),
      good: 0,
      needsCorrection: 0,
      flagged: 0,
      avgScore: null,
      avgRom: null,
      avgRepSeconds: null,
      holdAttempts: attempts,
      holdsCompleted: completed,
      bestHoldSeconds: bestHold,
      avgHoldSeconds: roundTo(bestHold * clamp(0.72 + jitter(random, 0.08), 0.5, 0.95), 1),
      completed: completed >= planned.sets,
    };
  }

  const targetReps = planned.reps ?? 10;
  const total = planned.sets * targetReps;
  const reps = Math.max(1, Math.round(total * clamp(lerp(arc.volumeFrom, arc.volumeTo, p) + jitter(random, 0.05), 0.4, 1.05)));
  const sets = Math.min(planned.sets, Math.ceil(reps / targetReps));
  const completed = reps >= total * 0.9;

  if (def.tracking !== 'scored') {
    return {
      ...common,
      reps,
      sets,
      good: 0,
      needsCorrection: 0,
      flagged: 0,
      avgScore: null,
      avgRom: null,
      avgRepSeconds: null,
      holdAttempts: 0,
      holdsCompleted: 0,
      bestHoldSeconds: null,
      avgHoldSeconds: null,
      completed,
    };
  }

  const score = clamp(lerp(arc.scoreFrom, arc.scoreTo, p) + jitter(random, 4), 35, 98);
  const good = Math.round(reps * clamp((score - 38) / 58, 0.05, 0.97));
  const needsCorrection = Math.round((reps - good) * 0.65);
  return {
    ...common,
    reps,
    sets,
    good,
    needsCorrection,
    flagged: reps - good - needsCorrection,
    avgScore: roundTo(score, 1),
    avgRom: roundTo(lerp(arc.romFrom, arc.romTo, p) + jitter(random, 3), 1),
    avgRepSeconds: roundTo(lerp(arc.tempoFrom, arc.tempoTo, p) + jitter(random, 0.15), 2),
    holdAttempts: 0,
    holdsCompleted: 0,
    bestHoldSeconds: null,
    avgHoldSeconds: null,
    completed,
  };
}

/** Makes every session for one person across the weeks. The progress p runs from 0 to 1 over the whole history. */
export function buildSessions(person: DemoPerson, patientId: string, options: HistoryOptions, index: number): PatientSession[] {
  const random = createRandom(options.seed + index * 7919);
  const arc = person.arc;
  const first = weekStart(options.now) - (options.weeks - 1) * WEEK_MS;
  const days = SESSION_DAYS.slice(0, arc.perWeek);
  const out: PatientSession[] = [];
  let counter = 0;

  for (let week = 0; week < options.weeks; week += 1) {
    days.forEach((day, slot) => {
      const startedAt = first + week * WEEK_MS + day * DAY_MS + (14 + Math.floor(random() * 3)) * 3_600_000 + Math.floor(random() * 50) * 60_000;
      // Sessions in the future or very recent, and missed days, are left out
      if (startedAt > options.now - 3 * 3_600_000 || random() < arc.miss) return;
      const p = shaped(arc.shape, clamp((week + slot / days.length) / Math.max(1, options.weeks - 1), 0, 1));
      const seconds = Math.round((arc.minutes + jitter(random, 4)) * 60);
      const heart = random() < arc.watchRate ? heartFor(person, p, seconds, random) : null;
      out.push({
        id: `demo-${person.slug}-${String(counter).padStart(3, '0')}`,
        patientId,
        startedAt,
        endedAt: startedAt + seconds * 1000,
        exercises: person.content.exercises.map((planned) => resultFor(planned, p, arc, heart, random)),
        heart,
        savedBy: 'demo-seed',
      });
      counter += 1;
    });
  }
  return out;
}