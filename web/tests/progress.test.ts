/** Tests for weekly progress, change between weeks, timed holds and the progress report. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProgressReport, changeBetween, sessionsFromSummary, weekStart, weeklyProgress } from '../src/domain';
import type { ExerciseResult, PatientSession } from '../src/domain';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 0, 5);

/** A scored exercise result with defaults. */
function result(over: Partial<ExerciseResult> = {}): ExerciseResult {
  return {
    exerciseId: 'goblet_squat',
    name: 'Goblet squat',
    tracking: 'scored',
    targetSets: 2,
    targetReps: 10,
    reps: 10,
    sets: 1,
    good: 8,
    needsCorrection: 1,
    flagged: 1,
    avgScore: 80,
    avgRom: 70,
    avgRepSeconds: 2,
    completed: true,
    ...over,
  };
}

/** A saved session on the given day of the week. */
function session(id: string, day: number, exercises: ExerciseResult[]): PatientSession {
  const startedAt = MON + day * DAY;
  return { id, patientId: 'p1', startedAt, endedAt: startedAt + 30 * 60_000, exercises, savedBy: 'u1' };
}

describe('weekStart', () => {
  it('maps every day of a week to its Monday', () => {
    for (let d = 0; d < 7; d += 1) assert.equal(weekStart(MON + d * DAY + 3_600_000), MON);
    assert.equal(weekStart(MON + 7 * DAY), MON + 7 * DAY);
  });
  it('puts Sunday night in the earlier week', () => {
    assert.equal(weekStart(MON - 1), MON - 7 * DAY);
  });
});

describe('weeklyProgress', () => {
  it('weights averages by rep count and groups by week', () => {
    const sessions = [
      session('a', 0, [result({ reps: 10, good: 8, avgScore: 80, avgRom: 60, avgRepSeconds: 2 })]),
      session('b', 2, [result({ reps: 30, good: 27, avgScore: 90, avgRom: 80, avgRepSeconds: 3 })]),
      session('c', 8, [result({ reps: 10, good: 10, avgScore: 100, avgRom: 90, avgRepSeconds: 4 })]),
    ];
    const weeks = weeklyProgress(sessions, 'goblet_squat');
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0]!.weekStart, MON);
    assert.equal(weeks[0]!.sessions, 2);
    assert.equal(weeks[0]!.reps, 40);
    assert.equal(weeks[0]!.goodRate, 0.875);
    assert.equal(weeks[0]!.avgScore, 87.5);
    assert.equal(weeks[0]!.avgRom, 75);
    assert.equal(weeks[0]!.avgRepSeconds, 2.75);
    assert.equal(weeks[1]!.weekStart, MON + 7 * DAY);
    assert.equal(weeks[1]!.goodRate, 1);
  });

  it('ignores missing range of motion instead of treating it as zero', () => {
    const sessions = [
      session('a', 0, [result({ reps: 10, avgRom: null })]),
      session('b', 1, [result({ reps: 10, avgRom: 50 })]),
    ];
    assert.equal(weeklyProgress(sessions)[0]!.avgRom, 50);
    const old = [session('a', 0, [{ ...result(), avgRom: undefined, avgRepSeconds: undefined }])];
    assert.equal(weeklyProgress(old)[0]!.avgRom, null);
    assert.equal(weeklyProgress(old)[0]!.avgRepSeconds, null);
  });

  it('leaves the good-rep rate empty for count-only exercises', () => {
    const sessions = [session('a', 0, [result({ tracking: 'count_only', avgScore: null, good: 0, reps: 12 })])];
    const week = weeklyProgress(sessions)[0]!;
    assert.equal(week.reps, 12);
    assert.equal(week.goodRate, null);
    assert.equal(week.avgScore, null);
  });

  it('skips exercises with no reps and filters by exercise', () => {
    const sessions = [session('a', 0, [result({ reps: 0 }), result({ exerciseId: 'bird_dog', name: 'Bird dog', reps: 5 })])];
    assert.equal(weeklyProgress(sessions, 'goblet_squat').length, 0);
    assert.equal(weeklyProgress(sessions, 'bird_dog')[0]!.reps, 5);
  });
});

describe('changeBetween', () => {
  it('needs at least two weeks', () => {
    assert.equal(changeBetween(weeklyProgress([session('a', 0, [result()])])), null);
  });
  it('reports last minus first', () => {
    const sessions = [
      session('a', 0, [result({ avgRom: 60, avgScore: 70, good: 5, reps: 10, avgRepSeconds: 1.5 })]),
      session('b', 8, [result({ avgRom: 75, avgScore: 85, good: 9, reps: 10, avgRepSeconds: 2.5 })]),
    ];
    const change = changeBetween(weeklyProgress(sessions))!;
    assert.deepEqual([change.goodRate, change.avgScore, change.avgRom, change.avgRepSeconds], [0.4, 15, 15, 1]);
    assert.equal(change.bestHoldSeconds, null);
    assert.equal(change.holdsCompleted, null);
  });
});

describe('buildProgressReport', () => {
  it('summarises sessions and flags readiness to progress', () => {
    const sessions = [
      session('a', 0, [result({ reps: 22, good: 20 })]),
      session('b', 3, [result({ reps: 24, good: 21 })]),
      session('c', 9, [result({ exerciseId: 'bird_dog', name: 'Bird dog', reps: 8, good: 3 })]),
    ];
    const report = buildProgressReport(sessions);
    assert.equal(report.sessionCount, 3);
    assert.equal(report.totalReps, 54);
    assert.equal(report.from, MON);
    assert.equal(report.exercises.length, 2);
    const squat = report.exercises.find((e) => e.exerciseId === 'goblet_squat')!;
    assert.equal(squat.readyToProgress, true);
    assert.deepEqual(squat.goodRepsLastTwo, [20, 21]);
    assert.equal(report.exercises.find((e) => e.exerciseId === 'bird_dog')!.readyToProgress, false);
  });

  it('is empty for no sessions and caps the exercise list', () => {
    const empty = buildProgressReport([]);
    assert.equal(empty.sessionCount, 0);
    assert.equal(empty.from, null);
    assert.equal(empty.goodRate, null);
    const many = [session('a', 0, Array.from({ length: 12 }, (_, i) => result({ exerciseId: `ex${i}`, name: `Ex ${i}` })))];
    assert.equal(buildProgressReport(many, 5).exercises.length, 5);
  });

  it('does not let one-session history claim readiness', () => {
    const report = buildProgressReport([session('a', 0, [result({ reps: 30, good: 30 })])]);
    assert.equal(report.exercises[0]!.readyToProgress, false);
  });
});

describe('sessionsFromSummary with rom and tempo', () => {
  const base = { exercise_id: 'goblet_squat', name: 'Goblet squat', tracking: 'scored' as const, target_sets: 1, target_reps: 5, reps: 5, sets: 1, good: 4, needs_correction: 1, flagged: 0, avg_score: 85, completed: true };
  const summary = (extra: object) => ({ session_id: 's1', started_at: 100, ended_at: 200, participants: [{ patient_id: 'P-0001', board_name: 'Al', exercises: [{ ...base, ...extra }] }] });

  it('carries range of motion and tempo through', () => {
    const [s] = sessionsFromSummary(summary({ avg_rom: 71.5, avg_rep_seconds: 2.4 }), { 'P-0001': 'p1' }, 'u1');
    assert.equal(s!.exercises[0]!.avgRom, 71.5);
    assert.equal(s!.exercises[0]!.avgRepSeconds, 2.4);
  });

  it('stores null, never undefined, when the hub did not send them', () => {
    const [s] = sessionsFromSummary(summary({}), { 'P-0001': 'p1' }, 'u1');
    assert.equal(s!.exercises[0]!.avgRom, null);
    assert.equal(s!.exercises[0]!.avgRepSeconds, null);
  });
});

/** A timed hold result with defaults. */
function holdResult(over: Partial<ExerciseResult> = {}): ExerciseResult {
  return result({
    exerciseId: 'wall_sit', name: 'Wall sit', tracking: 'timed', targetReps: null, reps: 1, good: 0, needsCorrection: 0, flagged: 0,
    avgScore: null, avgRom: null, avgRepSeconds: 30, holdAttempts: 3, holdsCompleted: 1, bestHoldSeconds: 31, avgHoldSeconds: 21, ...over,
  });
}

describe('timed exercises', () => {
  it('aggregates hold attempts, completions, best and attempt-weighted average hold time', () => {
    const sessions = [
      session('a', 0, [holdResult({ holdAttempts: 2, holdsCompleted: 0, bestHoldSeconds: 12, avgHoldSeconds: 10, reps: 0 })]),
      session('b', 2, [holdResult({ holdAttempts: 4, holdsCompleted: 2, bestHoldSeconds: 33, avgHoldSeconds: 25 })]),
    ];
    const week = weeklyProgress(sessions, 'wall_sit')[0]!;
    assert.equal(week.holdAttempts, 6);
    assert.equal(week.holdsCompleted, 2);
    assert.equal(week.bestHoldSeconds, 33);
    assert.equal(week.avgHoldSeconds, 20);
  });

  it('keeps an exercise that only has attempts shorter than the target', () => {
    const sessions = [session('a', 0, [holdResult({ reps: 0, holdsCompleted: 0, holdAttempts: 2, bestHoldSeconds: 9, avgHoldSeconds: 7 })])];
    const report = buildProgressReport(sessions);
    assert.equal(report.sessionCount, 1);
    assert.equal(report.exercises.length, 1);
    assert.equal(report.exercises[0]!.timed, true);
    assert.equal(report.exercises[0]!.holdAttempts, 2);
    assert.equal(report.exercises[0]!.holdsCompleted, 0);
  });

  it('reports the change in longest hold between the first and last week', () => {
    const sessions = [
      session('a', 0, [holdResult({ bestHoldSeconds: 10, avgHoldSeconds: 9, holdsCompleted: 0 })]),
      session('b', 8, [holdResult({ bestHoldSeconds: 28, avgHoldSeconds: 22, holdsCompleted: 2 })]),
    ];
    const ex = buildProgressReport(sessions).exercises[0]!;
    assert.equal(ex.change!.bestHoldSeconds, 18);
    assert.equal(ex.change!.avgHoldSeconds, 13);
    assert.equal(ex.change!.holdsCompleted, 2);
    assert.equal(ex.readyToProgress, false);
  });

  it('does not mark rep exercises as timed or invent hold data for them', () => {
    const ex = buildProgressReport([session('a', 0, [result()])]).exercises[0]!;
    assert.equal(ex.timed, false);
    assert.equal(ex.weeks[0]!.holdAttempts, 0);
    assert.equal(ex.weeks[0]!.bestHoldSeconds, null);
  });
});

describe('sessionsFromSummary with hold statistics', () => {
  const base = { exercise_id: 'wall_sit', name: 'Wall sit', tracking: 'timed' as const, target_sets: 1, target_reps: null, reps: 1, sets: 1, good: 0, needs_correction: 0, flagged: 0, avg_score: null, completed: true };
  const summary = (extra: object) => ({ session_id: 's1', started_at: 100, ended_at: 200, participants: [{ patient_id: 'P-0001', board_name: 'Al', exercises: [{ ...base, ...extra }] }] });

  it('carries hold statistics through', () => {
    const [s] = sessionsFromSummary(summary({ hold_attempts: 3, holds_completed: 1, best_hold_seconds: 31, avg_hold_seconds: 21 }), { 'P-0001': 'p1' }, 'u1');
    const e = s!.exercises[0]!;
    assert.deepEqual([e.holdAttempts, e.holdsCompleted, e.bestHoldSeconds, e.avgHoldSeconds], [3, 1, 31, 21]);
  });

  it('defaults to zero and null, and still saves a session with only short attempts', () => {
    const [none] = sessionsFromSummary(summary({}), { 'P-0001': 'p1' }, 'u1');
    assert.deepEqual([none!.exercises[0]!.holdAttempts, none!.exercises[0]!.bestHoldSeconds], [0, null]);
    const [short] = sessionsFromSummary(summary({ reps: 0, completed: false, hold_attempts: 2, best_hold_seconds: 8 }), { 'P-0001': 'p1' }, 'u1');
    assert.equal(short!.exercises[0]!.holdAttempts, 2);
  });
});
