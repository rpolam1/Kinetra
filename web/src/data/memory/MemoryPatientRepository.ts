import {
  buildNameKeys,
  classifySearchQuery,
  cleanPatientData,
  formatPatientCode,
  hasErrors,
  validatePatientData,
} from '../../domain';
import type { Patient, PatientData, TagRegistry } from '../../domain';
import { DEFAULT_SEARCH_LIMIT, DataError } from '../repositories';
import type { PatientRepository } from '../repositories';
import { lowestFreeTag } from '../registry';
import type { MemoryStore } from './MemoryStore';

/** Patients kept in the in memory store. Results are cloned so callers cannot change the stored data by accident. */
export class MemoryPatientRepository implements PatientRepository {
  constructor(private readonly store: MemoryStore) {}

  async create(data: PatientData, actorUid: string): Promise<Patient> {
    const clean = cleanPatientData(data);
    if (hasErrors(validatePatientData(clean))) {
      throw new DataError('invalid', 'Patient data failed validation');
    }
    const { registry } = this.store;
    const tagId = lowestFreeTag(registry.tags);
    if (tagId === null) throw new DataError('no_free_tag', 'All 587 AprilTags are in use. Archive a patient first.');

    const now = this.store.now();
    const id = this.store.nextId('pat_');
    const patient: Patient = {
      ...clean,
      ...buildNameKeys(clean.firstName, clean.lastName),
      id,
      code: formatPatientCode(registry.nextCode),
      tagId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      prescriptionVersion: 0,
    };
    registry.nextCode += 1;
    registry.tags[tagId] = { patientId: id, code: patient.code, boardName: patient.boardName };
    this.store.patients.set(id, patient);
    this.store.persist();
    return structuredClone(patient);
  }

  async get(id: string): Promise<Patient | null> {
    const p = this.store.patients.get(id);
    return p ? structuredClone(p) : null;
  }

  async update(id: string, data: PatientData, _actorUid: string): Promise<Patient> {
    const existing = this.store.patients.get(id);
    if (!existing) throw new DataError('not_found', 'Patient not found');
    const clean = cleanPatientData(data);
    if (hasErrors(validatePatientData(clean))) {
      throw new DataError('invalid', 'Patient data failed validation');
    }
    const updated: Patient = {
      ...existing,
      ...clean,
      ...buildNameKeys(clean.firstName, clean.lastName),
      updatedAt: this.store.now(),
    };
    this.store.patients.set(id, updated);
    if (updated.tagId !== null) {
      this.store.registry.tags[updated.tagId] = {
        patientId: id,
        code: updated.code,
        boardName: updated.boardName,
      };
    }
    this.store.persist();
    return structuredClone(updated);
  }

  async search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    const intent = classifySearchQuery(query);
    const all = [...this.store.patients.values()];
    let found: Patient[];
    switch (intent.kind) {
      case 'empty':
        return [];
      case 'code':
        found = all.filter((p) => p.code === intent.code);
        break;
      case 'tag':
        found = all.filter((p) => p.tagId === intent.tagId);
        break;
      case 'name':
        found = all.filter(
          (p) => p.nameKey.startsWith(intent.prefix) || p.nameKeyAlt.startsWith(intent.prefix),
        );
        break;
    }
    return found
      .sort((a, b) => a.nameKey.localeCompare(b.nameKey))
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }

  async recent(limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    return [...this.store.patients.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }

  async archive(id: string, _actorUid: string): Promise<Patient> {
    const p = this.store.patients.get(id);
    if (!p) throw new DataError('not_found', 'Patient not found');
    if (p.tagId !== null) delete this.store.registry.tags[p.tagId];
    const archived: Patient = { ...p, status: 'archived', tagId: null, updatedAt: this.store.now() };
    this.store.patients.set(id, archived);
    this.store.persist();
    return structuredClone(archived);
  }

  async reassignTag(id: string, tagId: number): Promise<Patient> {
    const p = this.store.patients.get(id);
    if (!p) throw new DataError('not_found', 'Patient not found');
    if (p.status !== 'active') throw new DataError('conflict', 'Archived patients have no tag');
    const holder = this.store.registry.tags[tagId];
    if (holder && holder.patientId !== id) {
      throw new DataError('conflict', `Tag ${tagId} is already worn by ${holder.code}`);
    }
    if (p.tagId !== null) delete this.store.registry.tags[p.tagId];
    this.store.registry.tags[tagId] = { patientId: id, code: p.code, boardName: p.boardName };
    const updated: Patient = { ...p, tagId, updatedAt: this.store.now() };
    this.store.patients.set(id, updated);
    this.store.persist();
    return structuredClone(updated);
  }

  async tagRegistry(): Promise<TagRegistry> {
    return structuredClone(this.store.registry.tags);
  }
}
