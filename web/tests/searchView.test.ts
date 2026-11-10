import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNameKeys, classifySearchQuery, interimRows, searchKey, snapshotOf } from '../src/domain';
import type { Patient } from '../src/domain';

function patient(id: string, first: string, last: string): Patient {
  return { id, firstName: first, lastName: last, ...buildNameKeys(first, last) } as unknown as Patient;
}

const ROWS = [patient('1', 'Ana', 'Kowalski'), patient('2', 'Karl', 'Nguyen'), patient('3', 'Kim', 'Lee'), patient('4', 'Omar', 'Khan')];

describe('interim search rows', () => {
  it('has nothing before the first result', () => {
    assert.equal(interimRows(null, classifySearchQuery('ko')), null);
  });

  it('keeps the same rows for the same query', () => {
    const snap = snapshotOf('ko', ROWS);
    assert.equal(interimRows(snap, classifySearchQuery('ko')), ROWS);
  });

  it('narrows instantly when the query is extended', () => {
    const snap = snapshotOf('k', ROWS);
    const narrowed = interimRows(snap, classifySearchQuery('ko'))!;
    assert.deepEqual(narrowed.map((p) => p.id), ['1']);
  });

  it('matches on first name as well as last name', () => {
    const snap = snapshotOf('', ROWS);
    const narrowed = interimRows(snap, classifySearchQuery('ka'))!;
    assert.deepEqual(narrowed.map((p) => p.id), ['2']);
  });

  it('keeps the old rows when the query got shorter instead of flashing a subset', () => {
    const snap = snapshotOf('kow', [ROWS[0]!]);
    assert.equal(interimRows(snap, classifySearchQuery('ko'))!.length, 1);
  });

  it('keeps the old rows for a code or tag lookup until the answer arrives', () => {
    const snap = snapshotOf('ko', [ROWS[0]!]);
    assert.equal(interimRows(snap, classifySearchQuery('P-0042'))!.length, 1);
  });

  it('builds distinct keys per intent', () => {
    assert.notEqual(searchKey(classifySearchQuery('ko')), searchKey(classifySearchQuery('kow')));
    assert.equal(searchKey(classifySearchQuery('KO ')), searchKey(classifySearchQuery('ko')));
  });
});