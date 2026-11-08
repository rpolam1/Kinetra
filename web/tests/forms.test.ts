import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyPatientData, validatePatientData } from '../src/domain';
import { FORM_STEPS, errorsForSteps, firstStepWithErrors, stepOfError } from '../src/features/patients/form/steps';
import { addDays, addMonths, clampIso, daysInMonth, formatLong, isOutOfRange, monthGrid, normalizeTyped, parseIso, toIso, yearPageStart } from '../src/ui/calendar';

describe('calendar helpers', () => {
  it('parses only real calendar dates', () => {
    assert.deepEqual(parseIso('1948-03-14'), { year: 1948, month: 2, day: 14 });
    assert.equal(parseIso('2023-02-29'), null);
    assert.equal(parseIso('2024-02-29')?.day, 29);
    assert.equal(parseIso('1948-3-14'), null);
    assert.equal(parseIso('nope'), null);
  });
  it('round-trips and counts days', () => {
    assert.equal(toIso(1950, 4, 5), '1950-05-05');
    assert.equal(daysInMonth(2024, 1), 29);
    assert.equal(daysInMonth(2023, 1), 28);
  });
  it('builds a six-week grid that starts on a Sunday and marks the month', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    assert.equal(grid.length, 42);
    assert.equal(grid[0]!.iso, '2026-09-27');
    assert.equal(grid.filter((c) => c.inMonth).length, 31);
    assert.equal(new Date(grid[0]!.iso + 'T12:00:00').getDay(), 0);
  });
  it('moves by days and months without leaving the calendar', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonths('2026-01-15', -2), '2025-11-15');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  });
  it('clamps and checks ranges', () => {
    assert.equal(clampIso('2030-01-01', undefined, '2026-10-16'), '2026-10-16');
    assert.equal(clampIso('1900-01-01', '1920-01-01'), '1920-01-01');
    assert.equal(isOutOfRange('2030-01-01', undefined, '2026-10-16'), true);
    assert.equal(isOutOfRange('2020-01-01', undefined, '2026-10-16'), false);
    assert.equal(isOutOfRange('2020-01-01'), false);
  });
  it('pages years in blocks of 12 and writes dates out in words', () => {
    assert.equal(yearPageStart(1950), 1944);
    assert.equal(yearPageStart(1956), 1956);
    assert.equal(formatLong('1947-03-14'), 'Friday, March 14, 1947');
  });
  it('accepts a few typing habits for dates', () => {
    assert.equal(normalizeTyped('19500505'), '1950-05-05');
    assert.equal(normalizeTyped('1950.05.05'), '1950-05-05');
    assert.equal(normalizeTyped(' 1950-05-05 '), '1950-05-05');
    assert.equal(normalizeTyped('1950-0'), '1950-0');
  });
});

describe('new patient form steps', () => {
  it('puts every field the validator can report on a step', () => {
    const broken = emptyPatientData();
    broken.firstName = '';
    broken.dateOfBirth = '2999-01-01';
    broken.emergencyContact.name = 'X';
    broken.medications = [{ name: '', betaBlocker: false } as never];
    broken.consent.exercise = true;
    const errors = validatePatientData(broken);
    assert.ok(Object.keys(errors).length >= 4);
    for (const key of Object.keys(errors)) assert.ok(stepOfError(key) >= 0 && stepOfError(key) < FORM_STEPS.length, key);
  });
  it('maps keys to the right step', () => {
    assert.equal(stepOfError('firstName'), 0);
    assert.equal(stepOfError('emergencyContact.phone'), 0);
    assert.equal(FORM_STEPS[stepOfError('medications.0.name')]!.id, 'health');
    assert.equal(FORM_STEPS[stepOfError('baselineTests.1.date')]!.id, 'fitness');
    assert.equal(FORM_STEPS[stepOfError('consent.signedOn')]!.id, 'consent');
    assert.equal(stepOfError('something.new'), 0);
  });
  it('shows only the steps asked for, and finds the first broken one', () => {
    const errors = { firstName: 'a', 'consent.signedOn': 'b', restingHr: 'c' };
    assert.deepEqual(Object.keys(errorsForSteps(errors, new Set([3]))), ['restingHr']);
    assert.deepEqual(Object.keys(errorsForSteps(errors, new Set([0, 4]))).sort(), ['consent.signedOn', 'firstName']);
    assert.equal(firstStepWithErrors(errors), 0);
    assert.equal(firstStepWithErrors({ restingHr: 'c' }), 3);
    assert.equal(firstStepWithErrors({}), null);
  });
});
