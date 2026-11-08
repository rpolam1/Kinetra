import type { Prescription, PrescriptionContent } from '../../domain';
import { DEFAULT_HISTORY_LIMIT, DataError } from '../repositories';
import type { PrescriptionRepository } from '../repositories';
import type { MemoryStore } from './MemoryStore';

export const INITIAL_REASON = 'Initial prescription';

export class MemoryPrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly store: MemoryStore) {}

  private versions(patientId: string): Prescription[] {
    return this.store.prescriptions.get(patientId) ?? [];
  }

  async current(patientId: string): Promise<Prescription | null> {
    const latest = this.versions(patientId).at(-1);
    return latest ? structuredClone(latest) : null;
  }

  async history(patientId: string, limit: number = DEFAULT_HISTORY_LIMIT): Promise<Prescription[]> {
    return [...this.versions(patientId)].reverse().slice(0, limit).map((p) => structuredClone(p));
  }

  async save(
    patientId: string,
    content: PrescriptionContent,
    reason: string,
    actorUid: string,
  ): Promise<Prescription> {
    const patient = this.store.patients.get(patientId);
    if (!patient) throw new DataError('not_found', 'Patient not found');
    const existing = this.versions(patientId);
    const version = existing.length + 1;
    const trimmed = reason.trim();
    if (version > 1 && !trimmed) {
      throw new DataError('invalid', 'A reason is required when changing a prescription');
    }
    const saved: Prescription = {
      ...structuredClone(content),
      id: `rx_${patientId}_${String(version).padStart(4, '0')}`,
      patientId,
      version,
      status: 'current',
      reason: trimmed || INITIAL_REASON,
      createdBy: actorUid,
      createdAt: this.store.now(),
    };
    const superseded = existing.map((p) => ({ ...p, status: 'superseded' as const }));
    this.store.prescriptions.set(patientId, [...superseded, saved]);
    this.store.patients.set(patientId, { ...patient, prescriptionVersion: version });
    this.store.persist();
    return structuredClone(saved);
  }
}
