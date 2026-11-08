import { collection, doc, getDocs, limit as limitTo, orderBy, query, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CalibrationRecord, PatientSession } from '../../domain';
import { slotDocId } from '../../domain';
import { DEFAULT_HISTORY_LIMIT } from '../repositories';
import type { CalibrationRepository, SessionRepository } from '../repositories';
import { guard } from './errors';

export class FirestoreSessionRepository implements SessionRepository {
  constructor(private readonly db: Firestore) {}

  save(session: PatientSession): Promise<void> {
    return guard(() => setDoc(doc(this.db, 'patients', session.patientId, 'sessions', session.id), session));
  }

  forPatient(patientId: string, limit: number = DEFAULT_HISTORY_LIMIT): Promise<PatientSession[]> {
    return guard(async () => {
      const q = query(collection(this.db, 'patients', patientId, 'sessions'), orderBy('startedAt', 'desc'), limitTo(limit));
      return (await getDocs(q)).docs.map((d) => d.data() as PatientSession);
    });
  }
}

export class FirestoreCalibrationRepository implements CalibrationRepository {
  constructor(private readonly db: Firestore) {}

  save(patientId: string, record: CalibrationRecord): Promise<void> {
    return guard(() => setDoc(doc(this.db, 'patients', patientId, 'calibrations', slotDocId(record.slot)), record));
  }

  forPatient(patientId: string): Promise<CalibrationRecord[]> {
    return guard(async () => (await getDocs(collection(this.db, 'patients', patientId, 'calibrations'))).docs.map((d) => d.data() as CalibrationRecord));
  }
}
