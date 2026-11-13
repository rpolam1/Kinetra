/** Tests for heart rate in the session summary, the progress report and the printed report. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProgressReport, emptyPatientData, heartProgress, sessionsFromSummary } from '../src/domain';
import type { ExerciseResult, Patient, PatientSession, Prescription, SessionHeart } from '../src/domain';
import { buildReportHtml, highlights } from '../src/features/progress/reportHtml';
import { HEART_TONES, heartZoneFor, toParticipantInput } from '../src/features/session/roster';
import type { SessionSummary } from '../src/services/hub/types';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 0, 5);

/** An exercise result with defaults. */
function result(over: Partial<ExerciseResult> = {}): ExerciseResult {
  return { exerciseId: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', targetSets: 2, targetReps: 10, reps: 20, sets: 2, good: 14, needsCorrection: 4, flagged: 2, avgScore: 78, avgRom: 70, avgRepSeconds: 2, completed: true, ...over };
}

/** A heart summary for one session with defaults. */
function heart(over: Partial<SessionHeart> = {}): SessionHeart {
  return { samples: 100, avgBpm: 120, minBpm: 90, maxBpm: 150, secondsTotal: 100, secondsInZone: 60, secondsBelow: 20, secondsAbove: 20, zoneLow: 108, zoneHigh: 132, ...over };
}

/** A saved session on the given day of the week, with or without heart data. */
function session(id: string, day: number, h: SessionHeart | null | undefined): PatientSession {
  const startedAt = MON + day * DAY;
  return { id, patientId: 'p1', startedAt, endedAt: startedAt + 1_800_000, exercises: [result()], heart: h, savedBy: 'u1' };
}

const patient = { firstName: 'Ann', lastName: 'Lee', code: 'P-0001', dateOfBirth: '1950-01-01', goals: '' } as Patient;

/** A complete patient record for tests that need every field. */
function fullPatient(over: Partial<Patient> = {}): Patient {
  return { ...emptyPatientData(), id: 'p1', code: 'P-0001', tagId: 3, status: 'active', nameKey: '', nameKeyAlt: '', firstName: 'Ann', lastName: 'Lee', boardName: 'Ann L.', dateOfBirth: '1960-01-01', restingHr: 70, maxHr: null, ...over } as Patient;
}

const prescription = {
  id: 'rx', patientId: 'p1', version: 1, status: 'current', reason: '', createdBy: 'u', createdAt: 1, exercises: [],
  cardio: { machine: 'other', warmupMin: 0, mainMin: 0, cooldownMin: 0, intensityLowPct: 40, intensityHighPct: 60, notes: '' },
} as Prescription;

describe('session summary mapping', () => {
  const summary: SessionSummary = {
    session_id: 's1', started_at: 1000, ended_at: 2000,
    participants: [{
      patient_id: 'P-0001', board_name: 'Ann L.',
      exercises: [{ exercise_id: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', target_sets: 2, target_reps: 10, reps: 10, sets: 1, good: 8, needs_correction: 1, flagged: 1, avg_score: 80, avg_hr: 118, peak_hr: 141, completed: true }],
      heart: { samples: 50, avg_bpm: 120, min_bpm: 88, max_bpm: 150, seconds_total: 55, seconds_in_zone: 30, seconds_below: 10, seconds_above: 15, zone: { low: 108, high: 132, max: 160, resting: 70 } },
    }],
  };
  it('keeps the session heart summary and the per-exercise heart rate', () => {
    const [record] = sessionsFromSummary(summary, { 'P-0001': 'p1' }, 'u1');
    assert.equal(record!.heart!.avgBpm, 120);
    assert.equal(record!.heart!.secondsInZone, 30);
    assert.equal(record!.heart!.zoneHigh, 132);
    assert.equal(record!.exercises[0]!.avgHr, 118);
    assert.equal(record!.exercises[0]!.peakHr, 141);
  });
  it('stores no heart data when the hub sent none', () => {
    const plain: SessionSummary = { ...summary, participants: [{ ...summary.participants[0]!, heart: null }] };
    assert.equal(sessionsFromSummary(plain, { 'P-0001': 'p1' }, 'u1')[0]!.heart, null);
    const absent: SessionSummary = { ...summary, participants: [{ patient_id: 'P-0001', board_name: 'A', exercises: summary.participants[0]!.exercises }] };
    assert.equal(sessionsFromSummary(absent, { 'P-0001': 'p1' }, 'u1')[0]!.heart, null);
  });
});

describe('heartProgress', () => {
  it('is null when no session has heart data', () => {
    assert.equal(heartProgress([session('a', 0, null), session('b', 1, undefined)]), null);
    assert.equal(buildProgressReport([session('a', 0, null)]).heart, null);
  });
  it('weights averages by recorded time and pools time in zone', () => {
    const report = heartProgress([
      session('a', 0, heart({ avgBpm: 100, secondsTotal: 100, secondsInZone: 50, secondsBelow: 50, secondsAbove: 0, maxBpm: 130 })),
      session('b', 2, heart({ avgBpm: 130, secondsTotal: 300, secondsInZone: 150, secondsBelow: 0, secondsAbove: 150, maxBpm: 160 })),
    ])!;
    assert.equal(report.sessions, 2);
    assert.equal(report.avgBpm, 123);
    assert.equal(report.peakBpm, 160);
    assert.equal(report.inZoneRate, 0.5);
    assert.equal(report.belowRate, 0.125);
    assert.equal(report.aboveRate, 0.375);
    assert.equal(report.weeks.length, 1);
  });
  it('splits sessions into weeks', () => {
    const report = heartProgress([session('a', 0, heart({ avgBpm: 110 })), session('b', 8, heart({ avgBpm: 130 }))])!;
    assert.deepEqual(report.weeks.map((w) => w.avgBpm), [110, 130]);
  });
  it('leaves zone shares empty when the zone was unreliable', () => {
    const report = heartProgress([session('a', 0, heart({ secondsInZone: null, secondsBelow: null, secondsAbove: null, zoneLow: null, zoneHigh: null }))])!;
    assert.equal(report.inZoneRate, null);
    assert.equal(report.zoneLow, null);
  });
});

describe('report with heart rate', () => {
  const report = buildProgressReport([session('a', 0, heart()), session('b', 8, heart({ avgBpm: 125 }))]);
  it('adds a heart rate section and a highlight to the printable report', () => {
    const html = buildReportHtml(patient, report, MON);
    assert.ok(html.includes('Average heart rate'));
    assert.ok(html.includes('target zone 108 to 132 bpm'));
    assert.ok(highlights(report)[0]!.includes('target zone'));
  });
  it('leaves the section out when there is no heart data', () => {
    const html = buildReportHtml(patient, buildProgressReport([session('a', 0, null)]), MON);
    assert.ok(!html.includes('Average heart rate'));
  });
});

describe('heart zone for the session', () => {
  it('uses the prescribed intensity and the resting heart rate', () => {
    const zone = heartZoneFor(fullPatient({ dateOfBirth: '1960-01-01' }), prescription)!;
    assert.equal(zone.resting, 70);
    assert.ok(zone.max > zone.high && zone.high > zone.low && zone.low > zone.resting);
    assert.equal(zone.reliable, true);
  });
  it('uses a measured maximum when there is one', () => {
    const zone = heartZoneFor(fullPatient({ maxHr: 170 }), { ...prescription, cardio: { ...prescription.cardio, intensityLowPct: 50, intensityHighPct: 70 } })!;
    assert.deepEqual(zone, { resting: 70, max: 170, low: 120, high: 140, reliable: true });
  });
  it('has no zone without a resting heart rate', () => {
    assert.equal(heartZoneFor(fullPatient({ restingHr: null }), prescription), null);
  });
  it('marks a patient on a beta blocker as not reliable', () => {
    const medications = [{ name: 'Metoprolol', betaBlocker: true }];
    assert.equal(heartZoneFor(fullPatient({ medications } as Partial<Patient>), prescription)!.reliable, false);
  });
  it('is sent to the hub with the session participant', () => {
    const person = toParticipantInput(fullPatient({ maxHr: 170 }), { ...prescription, exercises: [] });
    assert.equal(person.heart_zone!.max, 170);
    assert.equal(person.patient_id, 'P-0001');
  });
  it('has a tone for every status', () => {
    for (const s of ['no_signal', 'no_target', 'unreliable', 'below', 'in_zone', 'above', 'high'] as const) assert.ok(HEART_TONES[s].label);
  });
});
