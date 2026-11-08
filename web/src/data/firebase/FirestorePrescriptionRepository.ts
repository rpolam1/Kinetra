import {
  collection,
  doc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import type { DocumentData, Firestore } from 'firebase/firestore';
import type { Prescription, PrescriptionContent } from '../../domain';
import { DEFAULT_HISTORY_LIMIT, DataError } from '../repositories';
import type { PrescriptionRepository } from '../repositories';
import { guard } from './errors';

const INITIAL_REASON = 'Initial prescription';

function versionId(version: number): string {
  return `v${String(version).padStart(4, '0')}`;
}

function toPrescription(id: string, data: DocumentData): Prescription {
  return { ...(data as Omit<Prescription, 'id'>), id };
}

export class FirestorePrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly db: Firestore) {}

  private versions(patientId: string) {
    return collection(this.db, 'patients', patientId, 'prescriptions');
  }

  current(patientId: string): Promise<Prescription | null> {
    return guard(async () => {
      const q = query(this.versions(patientId), where('status', '==', 'current'), limitTo(1));
      const snap = await getDocs(q);
      const first = snap.docs[0];
      return first ? toPrescription(first.id, first.data()) : null;
    });
  }

  history(patientId: string, limit: number = DEFAULT_HISTORY_LIMIT): Promise<Prescription[]> {
    return guard(async () => {
      const q = query(this.versions(patientId), orderBy('version', 'desc'), limitTo(limit));
      return (await getDocs(q)).docs.map((d) => toPrescription(d.id, d.data()));
    });
  }

  save(
    patientId: string,
    content: PrescriptionContent,
    reason: string,
    actorUid: string,
  ): Promise<Prescription> {
    const trimmed = reason.trim();
    return guard(() =>
      runTransaction(this.db, async (tx) => {
        const patientRef = doc(this.db, 'patients', patientId);
        const patientSnap = await tx.get(patientRef);
        if (!patientSnap.exists()) throw new DataError('not_found', 'Patient not found');
        const previous = (patientSnap.data().prescriptionVersion as number | undefined) ?? 0;
        const version = previous + 1;
        if (version > 1 && !trimmed) {
          throw new DataError('invalid', 'A reason is required when changing a prescription');
        }
        const created: Omit<Prescription, 'id'> = {
          ...content,
          patientId,
          version,
          status: 'current',
          reason: trimmed || INITIAL_REASON,
          createdBy: actorUid,
          createdAt: Date.now(),
        };
        if (previous > 0) {
          tx.update(doc(this.versions(patientId), versionId(previous)), { status: 'superseded' });
        }
        tx.set(doc(this.versions(patientId), versionId(version)), created);
        tx.update(patientRef, { prescriptionVersion: version, updatedAt: Date.now() });
        return { ...created, id: versionId(version) };
      }),
    );
  }
}
