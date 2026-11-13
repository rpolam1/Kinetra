import type { CalibrationRecord, PatientSession } from '../../domain';
import { slotDocId } from '../../domain';
import { DEFAULT_HISTORY_LIMIT, DataError } from '../repositories';
import type { CalibrationRepository, SessionRepository } from '../repositories';
import type { MemoryStore } from './MemoryStore';

/** Finished sessions kept in the in memory store. Saving a session with an existing id replaces it. */
export class MemorySessionRepository implements SessionRepository {
  constructor(private readonly store: MemoryStore) {}

  async save(session: PatientSession): Promise<void> {
    if (!this.store.patients.has(session.patientId)) throw new DataError('not_found', 'Patient not found');
    const others = (this.store.sessions.get(session.patientId) ?? []).filter((s) => s.id !== session.id);
    this.store.sessions.set(session.patientId, [...others, structuredClone(session)]);
    this.store.persist();
  }

  async forPatient(patientId: string, limit: number = DEFAULT_HISTORY_LIMIT): Promise<PatientSession[]> {
    return [...(this.store.sessions.get(patientId) ?? [])]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map((s) => structuredClone(s));
  }
}

/** Calibration records kept in the in memory store, one per exercise and camera. */
export class MemoryCalibrationRepository implements CalibrationRepository {
  constructor(private readonly store: MemoryStore) {}

  async save(patientId: string, record: CalibrationRecord): Promise<void> {
    if (!this.store.patients.has(patientId)) throw new DataError('not_found', 'Patient not found');
    const all = { ...(this.store.calibrations.get(patientId) ?? {}), [slotDocId(record.slot)]: structuredClone(record) };
    this.store.calibrations.set(patientId, all);
    this.store.persist();
  }

  async forPatient(patientId: string): Promise<CalibrationRecord[]> {
    return Object.values(this.store.calibrations.get(patientId) ?? {}).map((r) => structuredClone(r));
  }
}
