/** Tests for the data layer against the in memory backend, including codes, tags, search, caching and prescription versions. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachedPatientRepository } from '../src/data/CachedPatientRepository';
import { createDataLayer } from '../src/data/createDataLayer';
import { MemoryAuthService } from '../src/data/memory/MemoryAuthService';
import { MemoryPatientRepository } from '../src/data/memory/MemoryPatientRepository';
import { MemoryPrescriptionRepository } from '../src/data/memory/MemoryPrescriptionRepository';
import { MemoryStore } from '../src/data/memory/MemoryStore';
import type { KeyValueStorage } from '../src/data/memory/MemoryStore';
import { DataError } from '../src/data/repositories';
import type { PatientRepository } from '../src/data/repositories';
import { lowestFreeTag } from '../src/data/registry';
import { requireFirebaseConfig } from '../src/config/env';
import { defaultCardio, emptyPatientData, getExercise, newPrescribedExercise } from '../src/domain';
import type { PatientData, PrescriptionContent } from '../src/domain';

/** Patient data with the required fields filled in. */
function person(first: string, last: string, extra: Partial<PatientData> = {}): PatientData {
  return {
    ...emptyPatientData(),
    firstName: first,
    lastName: last,
    boardName: `${first} ${last[0]}.`,
    dateOfBirth: '1950-05-05',
    ...extra,
  };
}

/** A fresh store with a fake clock that moves forward on every call, so timestamps are always different. */
function setup() {
  let t = 1_000;
  const store = new MemoryStore(undefined, () => (t += 10));
  return { store, patients: new MemoryPatientRepository(store), rx: new MemoryPrescriptionRepository(store) };
}

/** Checks that a promise fails with a data error of the given code. */
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof DataError && e.code === code);
}

describe('patients: create', () => {
  it('assigns a sequential code, tag 0 first, and search keys', async () => {
    const { patients } = setup();
    const a = await patients.create(person('Ana', 'Kowalski'), 'u1');
    const b = await patients.create(person('Bo', 'Li'), 'u1');
    assert.deepEqual([a.code, a.tagId, a.status], ['P-0001', 0, 'active']);
    assert.deepEqual([b.code, b.tagId], ['P-0002', 1]);
    assert.equal(a.nameKey, 'kowalski ana');
    assert.equal(a.nameKeyAlt, 'ana kowalski');
    assert.equal(a.createdBy, 'u1');
  });
  it('rejects invalid data and creates nothing', async () => {
    const { patients, store } = setup();
    await rejects(patients.create(person('', 'X'), 'u1'), 'invalid');
    assert.equal(store.patients.size, 0);
    assert.equal(store.registry.nextCode, 1);
  });
  it('trims whitespace before saving', async () => {
    const { patients } = setup();
    const p = await patients.create(person('  Ana ', ' Kowalski '), 'u1');
    assert.deepEqual([p.firstName, p.lastName], ['Ana', 'Kowalski']);
  });
  it('never hands out the same tag twice and reuses the lowest freed one', async () => {
    const { patients } = setup();
    const made = [];
    for (let i = 0; i < 5; i += 1) made.push(await patients.create(person(`P${i}`, 'Test'), 'u'));
    assert.deepEqual(made.map((p) => p.tagId), [0, 1, 2, 3, 4]);
    await patients.archive(made[1]!.id, 'u');
    await patients.archive(made[3]!.id, 'u');
    const next = await patients.create(person('New', 'One'), 'u');
    assert.equal(next.tagId, 1); // lowest free
    assert.equal(next.code, 'P-0006'); // codes are never reused
  });
  it('fails clearly when all 587 tags are taken', async () => {
    const { patients, store } = setup();
    for (let i = 0; i <= 586; i += 1) store.registry.tags[i] = { patientId: `x${i}`, code: `P-${i}`, boardName: 'x' };
    assert.equal(lowestFreeTag(store.registry.tags), null);
    await rejects(patients.create(person('Late', 'Comer'), 'u'), 'no_free_tag');
  });
});

describe('patients: update, archive, tags', () => {
  it('update recomputes search keys and keeps identity fields', async () => {
    const { patients, store } = setup();
    const p = await patients.create(person('Ana', 'Kowalski'), 'u1');
    const u = await patients.update(p.id, person('Anna', 'Kowalska', { boardName: 'Anna K.' }), 'u2');
    assert.deepEqual([u.nameKey, u.code, u.tagId, u.createdBy], ['kowalska anna', 'P-0001', 0, 'u1']);
    assert.equal(store.registry.tags[0]!.boardName, 'Anna K.'); // hub copy stays in step
    await rejects(patients.update('nope', person('A', 'B'), 'u'), 'not_found');
    await rejects(patients.update(p.id, person('', 'B'), 'u'), 'invalid');
  });
  it('archiving frees the tag, drops it from the registry and keeps the record', async () => {
    const { patients } = setup();
    const p = await patients.create(person('Ana', 'K'), 'u');
    const a = await patients.archive(p.id, 'u');
    assert.deepEqual([a.status, a.tagId], ['archived', null]);
    assert.deepEqual(await patients.tagRegistry(), {});
    assert.equal((await patients.get(p.id))?.firstName, 'Ana');
    await rejects(patients.archive('nope', 'u'), 'not_found');
  });
  it('reassigning a tag moves it, and refuses a tag someone else wears', async () => {
    const { patients } = setup();
    const a = await patients.create(person('A', 'One'), 'u');
    const b = await patients.create(person('B', 'Two'), 'u');
    const moved = await patients.reassignTag(a.id, 50);
    assert.equal(moved.tagId, 50);
    const reg = await patients.tagRegistry();
    assert.deepEqual(Object.keys(reg).sort(), ['1', '50']);
    await rejects(patients.reassignTag(a.id, b.tagId!), 'conflict');
    await patients.archive(b.id, 'u');
    await rejects(patients.reassignTag(b.id, 7), 'conflict');
  });
});

describe('patients: search', () => {
  async function seeded() {
    const s = setup();
    for (const [f, l] of [['Ana', 'Kowalski'], ['Anders', 'Kovacs'], ['John', 'Smith'], ['José', 'Álvarez'], ['Bo', 'Li']] as const) {
      await s.patients.create(person(f, l), 'u');
    }
    return s.patients;
  }
  it('matches a name prefix in either order', async () => {
    const r = await seeded();
    assert.deepEqual((await r.search('kov')).map((p) => p.lastName), ['Kovacs']);
    assert.deepEqual((await r.search('ko')).map((p) => p.lastName), ['Kovacs', 'Kowalski']);
    assert.deepEqual((await r.search('john s')).map((p) => p.lastName), ['Smith']);
    assert.deepEqual((await r.search('smith j')).map((p) => p.lastName), ['Smith']);
  });
  it('ignores case and accents', async () => {
    const r = await seeded();
    assert.equal((await r.search('JOSE')).length, 1);
    assert.equal((await r.search('alvarez')).length, 1);
  });
  it('finds by patient code and by tag id', async () => {
    const r = await seeded();
    assert.equal((await r.search('P-0003'))[0]!.lastName, 'Smith');
    assert.equal((await r.search('p3'))[0]!.lastName, 'Smith');
    assert.equal((await r.search('#4'))[0]!.lastName, 'Li');
    assert.deepEqual(await r.search('P-0999'), []);
  });
  it('returns nothing for empty / too-short input and respects the limit', async () => {
    const r = await seeded();
    assert.deepEqual(await r.search(''), []);
    assert.deepEqual(await r.search('a'), []);
    assert.equal((await r.search('an', 1)).length, 1);
  });
  it('lists recent patients newest first', async () => {
    const { patients } = setup();
    const a = await patients.create(person('Aa', 'One'), 'u');
    await patients.create(person('Bb', 'Two'), 'u');
    await patients.update(a.id, person('Aa', 'One', { goals: 'walk' }), 'u');
    assert.deepEqual((await patients.recent(2)).map((p) => p.firstName), ['Aa', 'Bb']);
  });
});

describe('patients: caching', () => {
  function counting(inner: PatientRepository) {
    const calls = { search: 0, recent: 0, get: 0 };
    const spy: PatientRepository = {
      ...inner,
      create: (...a) => inner.create(...a),
      update: (...a) => inner.update(...a),
      archive: (...a) => inner.archive(...a),
      reassignTag: (...a) => inner.reassignTag(...a),
      tagRegistry: () => inner.tagRegistry(),
      search: (...a) => { calls.search += 1; return inner.search(...a); },
      recent: (...a) => { calls.recent += 1; return inner.recent(...a); },
      get: (...a) => { calls.get += 1; return inner.get(...a); },
    };
    return { spy, calls };
  }
  it('answers repeated and equivalent searches from memory', async () => {
    const { patients } = setup();
    await patients.create(person('Ana', 'Kowalski'), 'u');
    const { spy, calls } = counting(patients);
    const cached = new CachedPatientRepository(spy);
    await cached.search('kow');
    await cached.search('KOW ');
    await cached.search('kow');
    assert.equal(calls.search, 1);
    await cached.recent(); await cached.recent();
    assert.equal(calls.recent, 1);
  });
  it('never queries the backend for input that would be ignored', async () => {
    const { patients } = setup();
    const { spy, calls } = counting(patients);
    const cached = new CachedPatientRepository(spy);
    await cached.search(''); await cached.search('a');
    assert.equal(calls.search, 0);
  });
  it('clears everything on a write so lists are never stale', async () => {
    const { patients } = setup();
    const { spy, calls } = counting(patients);
    const cached = new CachedPatientRepository(spy);
    await cached.search('ana');
    const p = await cached.create(person('Ana', 'Kowalski'), 'u');
    assert.equal((await cached.search('ana')).length, 1);
    assert.equal(calls.search, 2);
    await cached.get(p.id); await cached.get(p.id);
    assert.equal(calls.get, 1);
    await cached.update(p.id, person('Ana', 'Kowalski', { goals: 'x' }), 'u');
    assert.equal((await cached.get(p.id))?.goals, 'x');
  });
  it('expires entries after the time-to-live', async () => {
    const { patients } = setup();
    const { spy, calls } = counting(patients);
    let now = 0;
    const cached = new CachedPatientRepository(spy, 1000, () => now);
    await cached.recent(); now = 999; await cached.recent();
    assert.equal(calls.recent, 1);
    now = 1001; await cached.recent();
    assert.equal(calls.recent, 2);
  });
});

describe('prescriptions: versioning', () => {
  const content = (ids: string[]): PrescriptionContent => ({
    exercises: ids.map((id) => newPrescribedExercise(getExercise(id)!)),
    cardio: defaultCardio(),
  });
  it('creates v1 with a default reason, then immutable v2+ that supersede', async () => {
    const { patients, rx } = setup();
    const p = await patients.create(person('Ana', 'K'), 'u');
    assert.equal(await rx.current(p.id), null);
    const v1 = await rx.save(p.id, content(['goblet_squat']), '', 'u1');
    assert.deepEqual([v1.version, v1.status, v1.reason], [1, 'current', 'Initial prescription']);
    const v2 = await rx.save(p.id, content(['goblet_squat', 'push_up']), 'added push', 'u2');
    assert.deepEqual([v2.version, v2.createdBy], [2, 'u2']);
    const history = await rx.history(p.id);
    assert.deepEqual(history.map((h) => [h.version, h.status]), [[2, 'current'], [1, 'superseded']]);
    assert.equal((await rx.current(p.id))!.version, 2);
    assert.equal(history[1]!.exercises.length, 1); // v1 is untouched
  });
  it('requires a reason to change an existing prescription', async () => {
    const { patients, rx } = setup();
    const p = await patients.create(person('Ana', 'K'), 'u');
    await rx.save(p.id, content(['goblet_squat']), '', 'u');
    await rejects(rx.save(p.id, content(['push_up']), '   ', 'u'), 'invalid');
    assert.equal((await rx.history(p.id)).length, 1);
  });
  it('rejects unknown patients and isolates patients from each other', async () => {
    const { patients, rx } = setup();
    await rejects(rx.save('ghost', content([]), '', 'u'), 'not_found');
    const a = await patients.create(person('A', 'One'), 'u');
    const b = await patients.create(person('B', 'Two'), 'u');
    await rx.save(a.id, content(['goblet_squat']), '', 'u');
    assert.equal(await rx.current(b.id), null);
  });
  it('does not let callers mutate stored versions', async () => {
    const { patients, rx } = setup();
    const p = await patients.create(person('Ana', 'K'), 'u');
    const v1 = await rx.save(p.id, content(['goblet_squat']), '', 'u');
    v1.exercises.length = 0;
    assert.equal((await rx.current(p.id))!.exercises.length, 1);
  });
});

describe('demo persistence and auth', () => {
  it('survives a "page refresh" through storage', async () => {
    const bag = new Map<string, string>();
    const storage: KeyValueStorage = { getItem: (k) => bag.get(k) ?? null, setItem: (k, v) => void bag.set(k, v) };
    const first = new MemoryStore(storage);
    const p = await new MemoryPatientRepository(first).create(person('Ana', 'K'), 'u');
    await new MemoryPrescriptionRepository(first).save(p.id, { exercises: [], cardio: defaultCardio() }, '', 'u');
    const second = new MemoryStore(storage);
    const repo = new MemoryPatientRepository(second);
    assert.equal((await repo.get(p.id))?.code, 'P-0001');
    assert.equal((await new MemoryPrescriptionRepository(second).current(p.id))?.version, 1);
    const next = await repo.create(person('Bo', 'L'), 'u');
    assert.notEqual(next.id, p.id); // id counter was restored
    assert.equal(next.code, 'P-0002');
  });
  it('ignores corrupt stored data', () => {
    const storage: KeyValueStorage = { getItem: () => '{not json', setItem: () => undefined };
    assert.equal(new MemoryStore(storage).patients.size, 0);
  });
  it('signs demo users in and out and notifies subscribers', async () => {
    const auth = new MemoryAuthService();
    const seen: (string | null)[] = [];
    const off = auth.subscribe((u) => seen.push(u?.role ?? null));
    await rejects(auth.signIn('instructor@demo.test', 'wrong'), 'permission');
    await rejects(auth.signIn('nobody@x.test', 'demo'), 'permission');
    assert.equal((await auth.signIn(' Instructor@Demo.test ', 'demo')).role, 'instructor');
    await auth.signOut();
    off();
    await auth.signIn('admin@demo.test', 'demo');
    assert.deepEqual(seen, [null, 'instructor', null]);
  });
});

describe('configuration', () => {
  it('names every missing Firebase variable and never contains secrets itself', () => {
    assert.throws(
      () => requireFirebaseConfig({ apiKey: '', authDomain: 'a', projectId: '', appId: '' }),
      /VITE_FIREBASE_API_KEY.*VITE_FIREBASE_PROJECT_ID.*VITE_FIREBASE_APP_ID/,
    );
    assert.doesNotThrow(() => requireFirebaseConfig({ apiKey: 'k', authDomain: 'a', projectId: 'p', appId: 'i' }));
  });
  it('defaults to the demo backend and builds a working layer', async () => {
    const layer = await createDataLayer({ backend: 'memory' });
    assert.equal(layer.mode, 'memory');
    const p = await layer.patients.create(person('Ana', 'K'), 'u');
    assert.equal((await layer.patients.search('ana'))[0]!.id, p.id);
  });
});
