import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATEGORY_ORDER,
  DOSE_GUIDELINES,
  EXERCISES,
  SESSION_SLOTS,
  buildNameKeys,
  can,
  cardioWarnings,
  checkSlots,
  classifySearchQuery,
  cleanPatientData,
  computeAge,
  contentEquals,
  defaultBoardName,
  defaultCardio,
  describeDiff,
  diffContent,
  doseWarnings,
  emptyContent,
  emptyPatientData,
  estimateMaxHr,
  formatPatientCode,
  getExercise,
  hasBetaBlocker,
  hasErrors,
  heartRateZone,
  isValidIsoDate,
  moveItem,
  newPrescribedExercise,
  normalizeText,
  searchExercises,
  sessionsUntilRotation,
  shouldProgress,
  stretchCoverage,
  suitabilityWarnings,
  validatePatientData,
} from '../src/domain';
import type { PatientData, PrescribedExercise } from '../src/domain';

const TODAY = new Date(2026, 9, 8); // 2026-10-08

function validPatient(): PatientData {
  return {
    ...emptyPatientData(),
    firstName: 'Ana',
    lastName: 'Kowalski',
    boardName: 'Ana K.',
    dateOfBirth: '1948-03-14',
  };
}
const ex = (id: string): PrescribedExercise => newPrescribedExercise(getExercise(id)!);

describe('exercise library (shared with the Python vision system)', () => {
  it('loads every exercise with unique ids', () => {
    assert.equal(EXERCISES.length, 61);
    assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  });
  it('covers every category and all three scoring modes in use', () => {
    for (const c of CATEGORY_ORDER) assert.ok(EXERCISES.some((e) => e.category === c), c);
    assert.ok(EXERCISES.filter((e) => e.tracking === 'scored').length >= 30);
  });
  it('keeps the exercises the vision system already used', () => {
    for (const id of ['goblet_squat', 'lunge', 'push_up', 'plank', 'bicep_curl']) {
      assert.ok(getExercise(id), id);
    }
  });
  it('searches by name and equipment, optionally within a category', () => {
    assert.ok(searchExercises('squat').every((e) => /squat/i.test(e.name)));
    assert.ok(searchExercises('kettlebell').some((e) => e.id === 'kettlebell_swing'));
    assert.ok(searchExercises('curl', 'pull').every((e) => e.category === 'pull'));
    assert.equal(searchExercises('zzzz').length, 0);
  });
});

describe('dates and ages', () => {
  it('validates calendar dates', () => {
    assert.ok(isValidIsoDate('2024-02-29'));
    assert.ok(!isValidIsoDate('2023-02-29'));
    assert.ok(!isValidIsoDate('2023-13-01'));
    assert.ok(!isValidIsoDate('14/03/1948'));
  });
  it('computes age with the birthday boundary', () => {
    assert.equal(computeAge('1948-10-08', TODAY), 78); // birthday today
    assert.equal(computeAge('1948-10-09', TODAY), 77); // tomorrow
    assert.equal(computeAge('2026-10-09', TODAY), null); // future
    assert.equal(computeAge('nope', TODAY), null);
  });
});

describe('names, codes and search intent', () => {
  it('normalises accents, case and spaces', () => {
    assert.equal(normalizeText('  José   ÁLVAREZ '), 'jose alvarez');
  });
  it('builds both name keys so "smith j" and "john s" both match', () => {
    assert.deepEqual(buildNameKeys('John', 'Smith'), { nameKey: 'smith john', nameKeyAlt: 'john smith' });
  });
  it('formats codes and default board names', () => {
    assert.equal(formatPatientCode(42), 'P-0042');
    assert.equal(defaultBoardName('Ana', 'Kowalski'), 'Ana K.');
    assert.equal(defaultBoardName('Ana', ''), 'Ana');
  });
  it('classifies search input into the cheapest lookup', () => {
    assert.deepEqual(classifySearchQuery(''), { kind: 'empty' });
    assert.deepEqual(classifySearchQuery('a'), { kind: 'empty' }); // too short to be useful
    assert.deepEqual(classifySearchQuery('p-42'), { kind: 'code', code: 'P-0042' });
    assert.deepEqual(classifySearchQuery('P0042'), { kind: 'code', code: 'P-0042' });
    assert.deepEqual(classifySearchQuery('#12'), { kind: 'tag', tagId: 12 });
    assert.deepEqual(classifySearchQuery('586'), { kind: 'tag', tagId: 586 });
    assert.deepEqual(classifySearchQuery('587'), { kind: 'empty' });
    assert.deepEqual(classifySearchQuery(' Kow '), { kind: 'name', prefix: 'kow' });
  });
});

describe('patient validation', () => {
  it('accepts a minimal valid patient', () => {
    assert.deepEqual(validatePatientData(validPatient(), TODAY), {});
  });
  it('requires names, board name and a real, non-future date of birth', () => {
    const e = validatePatientData(emptyPatientData(), TODAY);
    for (const k of ['firstName', 'lastName', 'boardName', 'dateOfBirth']) assert.ok(e[k], k);
    assert.ok(validatePatientData({ ...validPatient(), dateOfBirth: '2030-01-01' }, TODAY).dateOfBirth);
    assert.ok(validatePatientData({ ...validPatient(), dateOfBirth: '1800-01-01' }, TODAY).dateOfBirth);
  });
  it('validates optional contact details only when present', () => {
    const p = validPatient();
    assert.ok(validatePatientData({ ...p, phone: '123' }, TODAY).phone);
    assert.ok(validatePatientData({ ...p, email: 'not-an-email' }, TODAY).email);
    assert.deepEqual(validatePatientData({ ...p, phone: '(519) 555-0100', email: 'a@b.ca' }, TODAY), {});
  });
  it('requires a complete emergency contact once any part is filled in', () => {
    const e = validatePatientData(
      { ...validPatient(), emergencyContact: { name: 'Bo', phone: '', relationship: '' } },
      TODAY,
    );
    assert.ok(e['emergencyContact.phone']);
  });
  it('checks heart rates against each other', () => {
    const p = validPatient();
    assert.ok(validatePatientData({ ...p, restingHr: 10 }, TODAY).restingHr);
    assert.ok(validatePatientData({ ...p, restingHr: 70, maxHr: 80 }, TODAY).maxHr);
    assert.deepEqual(validatePatientData({ ...p, restingHr: 70, maxHr: 150 }, TODAY), {});
  });
  it('requires a consent date when consent is given', () => {
    const p = validPatient();
    const e = validatePatientData({ ...p, consent: { exercise: true, cameraTracking: true, signedOn: '' } }, TODAY);
    assert.ok(e['consent.signedOn']);
    const ok = validatePatientData(
      { ...p, consent: { exercise: true, cameraTracking: true, signedOn: '2026-10-01' } },
      TODAY,
    );
    assert.deepEqual(ok, {});
  });
  it('flags empty list entries by index and cleans them on save', () => {
    const p: PatientData = {
      ...validPatient(),
      diagnoses: ['Stroke', '  '],
      medications: [{ name: '', betaBlocker: false }],
      baselineTests: [{ name: 'Chair stand', result: '', date: '' }],
    };
    const e = validatePatientData(p, TODAY);
    assert.ok(e['diagnoses.1'] && e['medications.0.name'] && e['baselineTests.0.result']);
    assert.ok(hasErrors(e));
    assert.deepEqual(cleanPatientData({ ...p, diagnoses: [' Stroke ', ' '] }).diagnoses, ['Stroke']);
  });
});

describe('heart rate zones (Karvonen)', () => {
  it('estimates max HR with the Tanaka formula', () => {
    assert.equal(estimateMaxHr(70), 159);
  });
  it('computes 40-60% of heart-rate reserve from a measured max', () => {
    const z = heartRateZone({ age: 70, restingHr: 70, maxHr: 150, lowPct: 40, highPct: 60 })!;
    assert.deepEqual([z.reserve, z.lowBpm, z.highBpm, z.maxHrSource], [80, 102, 118, 'measured']);
  });
  it('falls back to an estimated max and says so', () => {
    const z = heartRateZone({ age: 70, restingHr: 70, maxHr: null, lowPct: 40, highPct: 60 })!;
    assert.equal(z.maxHrSource, 'estimated');
    assert.equal(z.maxHr, 159);
  });
  it('returns null when it cannot be computed', () => {
    assert.equal(heartRateZone({ age: 70, restingHr: null, maxHr: 150, lowPct: 40, highPct: 60 }), null);
    assert.equal(heartRateZone({ age: null, restingHr: 70, maxHr: null, lowPct: 40, highPct: 60 }), null);
    assert.equal(heartRateZone({ age: 70, restingHr: 160, maxHr: 150, lowPct: 40, highPct: 60 }), null);
  });
  it('detects beta-blockers', () => {
    assert.ok(hasBetaBlocker({ medications: [{ name: 'Metoprolol', betaBlocker: true }] }));
    assert.ok(!hasBetaBlocker({ medications: [] }));
  });
});

describe('session structure and warnings', () => {
  it('needs 2 mobility and one of each other category', () => {
    assert.equal(SESSION_SLOTS.find((s) => s.id === 'mobility')!.min, 2);
    const none = checkSlots([]);
    assert.ok(none.every((s) => !s.met));
    const complete = checkSlots(
      ['arm_rainbows', 'wall_angels', 'goblet_squat', 'push_up', 'romanian_deadlift', 'bicep_curl',
        'farmers_carry', 'plank', 'hamstring_stretch'].map(ex),
    );
    assert.ok(complete.every((s) => s.met), JSON.stringify(complete.filter((s) => !s.met)));
    assert.ok(!checkSlots([ex('arm_rainbows')])[0]!.met);
  });
  it('reports which stretch targets are missing', () => {
    const c = stretchCoverage([ex('hamstring_stretch'), ex('calf_stretch')]);
    assert.deepEqual(c.covered, ['hamstrings', 'calf']);
    assert.equal(c.missing.length, 5);
  });
  it('warns outside the 1-2 sets x 10-20 reps guideline, but not inside it', () => {
    const def = getExercise('goblet_squat')!;
    assert.deepEqual(doseWarnings(ex('goblet_squat'), def), []);
    assert.equal(doseWarnings({ ...ex('goblet_squat'), sets: 4, reps: 30 }, def).length, 2);
    assert.equal(doseWarnings({ ...ex('plank'), seconds: null }, getExercise('plank')!).length, 1);
  });
  it('checks the cardio block against the clinic ranges', () => {
    assert.deepEqual(cardioWarnings(defaultCardio()), []);
    assert.equal(cardioWarnings({ ...defaultCardio(), warmupMin: 1, mainMin: 60, cooldownMin: 20 }).length, 3);
    assert.equal(cardioWarnings({ ...defaultCardio(), intensityLowPct: 70 }).length, 1);
  });
  it('warns when an exercise does not suit mobility or falls risk', () => {
    const squat = getExercise('goblet_squat')!;
    const seated = getExercise('seated_row')!;
    const base = { mobilityAid: 'none', fallsRisk: 'low', supervision: 'independent' } as const;
    assert.equal(suitabilityWarnings(base, squat).length, 0);
    assert.equal(suitabilityWarnings({ ...base, mobilityAid: 'wheelchair' }, squat).length, 1);
    assert.equal(suitabilityWarnings({ ...base, mobilityAid: 'wheelchair' }, seated).length, 0);
    assert.equal(suitabilityWarnings({ ...base, fallsRisk: 'high' }, squat).length, 1);
    assert.equal(suitabilityWarnings({ ...base, fallsRisk: 'high', supervision: 'one_to_one' }, squat).length, 0);
  });
});

describe('progression rules', () => {
  it('progresses after 20 good reps in two sessions in a row', () => {
    assert.ok(shouldProgress([12, 20, 20]));
    assert.ok(!shouldProgress([20, 12, 20]));
    assert.ok(!shouldProgress([20]));
    assert.ok(!shouldProgress([]));
    assert.ok(shouldProgress([15, 15], 15));
  });
  it('counts sessions until a new 12-session block', () => {
    assert.equal(sessionsUntilRotation(0), DOSE_GUIDELINES.rotationSessions);
    assert.equal(sessionsUntilRotation(5), 7);
    assert.equal(sessionsUntilRotation(12), 0);
    assert.equal(sessionsUntilRotation(13), 11);
  });
});

describe('prescription versions', () => {
  const a = { exercises: [ex('goblet_squat'), ex('push_up')], cardio: defaultCardio() };

  it('compares content by value', () => {
    assert.ok(contentEquals(a, structuredClone(a)));
    assert.ok(!contentEquals(a, { ...a, exercises: [a.exercises[0]!] }));
  });
  it('describes additions, removals, changes, reordering and cardio edits', () => {
    const b = {
      exercises: [ex('push_up'), { ...a.exercises[0]!, load: '5 lb' }, ex('lunge')],
      cardio: { ...a.cardio, mainMin: 25 },
    };
    const d = diffContent(a, b);
    assert.deepEqual(d.added, ['lunge']);
    assert.deepEqual(d.changed, ['goblet_squat']);
    assert.ok(d.reordered && d.cardioChanged);
    assert.equal(describeDiff(d), '1 added, 1 changed, reordered, cardio changed');
    assert.equal(describeDiff(diffContent(a, structuredClone(a))), 'no changes');
  });
  it('treats the first version as all-added', () => {
    assert.equal(diffContent(null, a).added.length, 2);
    assert.equal(diffContent(null, emptyContent()).added.length, 0);
  });
  it('moves items without mutating or going out of range', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(moveItem(list, 2, 0), ['c', 'a', 'b']);
    assert.deepEqual(moveItem(list, 0, 9), list);
    assert.deepEqual(list, ['a', 'b', 'c']);
  });
  it('pre-fills a new line from the library', () => {
    const squat = ex('goblet_squat');
    assert.deepEqual([squat.sets, squat.reps, squat.progression], [2, 12, 'twenty_reps_two_sessions']);
    const plank = ex('plank');
    assert.deepEqual([plank.reps, plank.seconds, plank.progression], [null, 30, 'manual']);
  });
});

describe('permissions', () => {
  it('lets instructors do everything and volunteers only look and assist', () => {
    assert.ok(can('instructor', 'patient:create') && can('instructor', 'prescription:edit'));
    assert.ok(can('volunteer', 'patient:view') && can('volunteer', 'session:run'));
    assert.ok(!can('volunteer', 'patient:create') && !can('volunteer', 'prescription:edit'));
    assert.ok(!can(null, 'patient:view'));
  });
});
