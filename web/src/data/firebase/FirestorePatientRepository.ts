import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import type { DocumentData, Firestore, Query } from 'firebase/firestore';
import {
  buildNameKeys,
  classifySearchQuery,
  cleanPatientData,
  formatPatientCode,
  hasErrors,
  validatePatientData,
} from '../../domain';
import type { Patient, PatientData, TagRegistry, TagRegistryEntry } from '../../domain';
import { DEFAULT_SEARCH_LIMIT, DataError } from '../repositories';
import type { PatientRepository } from '../repositories';
import { emptyRegistry, lowestFreeTag } from '../registry';
import type { Registry } from '../registry';
import { guard } from './errors';

const PATIENTS = 'patients';
const REGISTRY_PATH = ['meta', 'registry'] as const;
// The highest private use character, so a range query on a prefix matches every name that starts with it
const PREFIX_END = '\uf8ff';

/** Read the registry document. A missing document gives an empty registry. */
function parseRegistry(data: DocumentData | undefined): Registry {
  if (!data) return emptyRegistry();
  const tags: TagRegistry = {};
  for (const [key, entry] of Object.entries((data.tags ?? {}) as Record<string, TagRegistryEntry>)) {
    tags[Number(key)] = entry;
  }
  return { nextCode: typeof data.nextCode === 'number' ? data.nextCode : 1, tags };
}

function serializeRegistry(registry: Registry): DocumentData {
  return { nextCode: registry.nextCode, tags: { ...registry.tags } };
}

function toPatient(id: string, data: DocumentData): Patient {
  return { ...(data as Omit<Patient, 'id'>), id };
}

/** Patients in Firestore. The tag registry is one document that is updated in the same transaction as the patient, so two patients can never get the same tag or code. */
export class FirestorePatientRepository implements PatientRepository {
  constructor(private readonly db: Firestore) {}

  private get registryRef() {
    return doc(this.db, ...REGISTRY_PATH);
  }

  /** Add a patient. One transaction gives them the next patient code and the lowest free tag. */
  create(data: PatientData, actorUid: string): Promise<Patient> {
    const clean = cleanPatientData(data);
    if (hasErrors(validatePatientData(clean))) {
      return Promise.reject(new DataError('invalid', 'Patient data failed validation'));
    }
    return guard(() =>
      runTransaction(this.db, async (tx) => {
        const registry = parseRegistry((await tx.get(this.registryRef)).data());
        const tagId = lowestFreeTag(registry.tags);
        if (tagId === null) {
          throw new DataError('no_free_tag', 'All 587 AprilTags are in use. Archive a patient first.');
        }
        const ref = doc(collection(this.db, PATIENTS));
        const now = Date.now();
        const code = formatPatientCode(registry.nextCode);
        const patient: Omit<Patient, 'id'> = {
          ...clean,
          ...buildNameKeys(clean.firstName, clean.lastName),
          code,
          tagId,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          createdBy: actorUid,
          prescriptionVersion: 0,
        };
        registry.tags[tagId] = { patientId: ref.id, code, boardName: patient.boardName };
        registry.nextCode += 1;
        tx.set(ref, patient);
        tx.set(this.registryRef, serializeRegistry(registry));
        return { ...patient, id: ref.id };
      }),
    );
  }

  get(id: string): Promise<Patient | null> {
    return guard(async () => {
      const snap = await getDoc(doc(this.db, PATIENTS, id));
      return snap.exists() ? toPatient(snap.id, snap.data()) : null;
    });
  }

  /** Save changes to a patient and refresh their entry in the tag registry. */
  update(id: string, data: PatientData, _actorUid: string): Promise<Patient> {
    const clean = cleanPatientData(data);
    if (hasErrors(validatePatientData(clean))) {
      return Promise.reject(new DataError('invalid', 'Patient data failed validation'));
    }
    return guard(() =>
      runTransaction(this.db, async (tx) => {
        const ref = doc(this.db, PATIENTS, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new DataError('not_found', 'Patient not found');
        const registry = parseRegistry((await tx.get(this.registryRef)).data());
        const existing = toPatient(snap.id, snap.data());
        const updated: Patient = {
          ...existing,
          ...clean,
          ...buildNameKeys(clean.firstName, clean.lastName),
          updatedAt: Date.now(),
        };
        const { id: _omit, ...stored } = updated;
        tx.set(ref, stored);
        if (updated.tagId !== null) {
          registry.tags[updated.tagId] = { patientId: id, code: updated.code, boardName: updated.boardName };
          tx.set(this.registryRef, serializeRegistry(registry));
        }
        return updated;
      }),
    );
  }

  /** Search by code, tag or name. A name search runs on both name forms and merges the results, so the first name or the last name can come first. */
  search(queryText: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    const intent = classifySearchQuery(queryText);
    const col = collection(this.db, PATIENTS);
    return guard(async () => {
      const read = async (q: Query<DocumentData>) =>
        (await getDocs(q)).docs.map((d) => toPatient(d.id, d.data()));
      switch (intent.kind) {
        case 'empty':
          return [];
        case 'code':
          return read(query(col, where('code', '==', intent.code), limitTo(1)));
        case 'tag':
          return read(query(col, where('tagId', '==', intent.tagId), limitTo(1)));
        case 'name': {
          const range = (field: 'nameKey' | 'nameKeyAlt') =>
            query(
              col,
              where(field, '>=', intent.prefix),
              where(field, '<=', intent.prefix + PREFIX_END),
              limitTo(limit),
            );
          const [byLast, byFirst] = await Promise.all([read(range('nameKey')), read(range('nameKeyAlt'))]);
          const merged = new Map([...byLast, ...byFirst].map((p) => [p.id, p]));
          return [...merged.values()].sort((a, b) => a.nameKey.localeCompare(b.nameKey)).slice(0, limit);
        }
      }
    });
  }

  /** The most recently edited patients. */
  recent(limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    return guard(async () => {
      const q = query(collection(this.db, PATIENTS), orderBy('updatedAt', 'desc'), limitTo(limit));
      return (await getDocs(q)).docs.map((d) => toPatient(d.id, d.data()));
    });
  }

  /** Archive a patient and free their tag. */
  archive(id: string, _actorUid: string): Promise<Patient> {
    return guard(() =>
      runTransaction(this.db, async (tx) => {
        const ref = doc(this.db, PATIENTS, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new DataError('not_found', 'Patient not found');
        const registry = parseRegistry((await tx.get(this.registryRef)).data());
        const existing = toPatient(snap.id, snap.data());
        if (existing.tagId !== null) delete registry.tags[existing.tagId];
        const archived: Patient = { ...existing, status: 'archived', tagId: null, updatedAt: Date.now() };
        const { id: _omit, ...stored } = archived;
        tx.set(ref, stored);
        tx.set(this.registryRef, serializeRegistry(registry));
        return archived;
      }),
    );
  }

  /** Give a patient a different tag. Fails when another patient already wears it. */
  reassignTag(id: string, tagId: number): Promise<Patient> {
    return guard(() =>
      runTransaction(this.db, async (tx) => {
        const ref = doc(this.db, PATIENTS, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new DataError('not_found', 'Patient not found');
        const existing = toPatient(snap.id, snap.data());
        if (existing.status !== 'active') throw new DataError('conflict', 'Archived patients have no tag');
        const registry = parseRegistry((await tx.get(this.registryRef)).data());
        const holder = registry.tags[tagId];
        if (holder && holder.patientId !== id) {
          throw new DataError('conflict', `Tag ${tagId} is already worn by ${holder.code}`);
        }
        if (existing.tagId !== null) delete registry.tags[existing.tagId];
        registry.tags[tagId] = { patientId: id, code: existing.code, boardName: existing.boardName };
        const updated: Patient = { ...existing, tagId, updatedAt: Date.now() };
        const { id: _omit, ...stored } = updated;
        tx.set(ref, stored);
        tx.set(this.registryRef, serializeRegistry(registry));
        return updated;
      }),
    );
  }

  tagRegistry(): Promise<TagRegistry> {
    return guard(async () => parseRegistry((await getDoc(this.registryRef)).data()).tags);
  }
}
