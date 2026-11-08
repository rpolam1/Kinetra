import { env } from '../config/env';
import type { DataBackend } from '../config/env';
import { CachedPatientRepository } from './CachedPatientRepository';
import type { DataLayer } from './repositories';
import { MemoryAccountRepository } from './memory/MemoryAccountRepository';
import { MemoryAuthService } from './memory/MemoryAuthService';
import { MemoryPatientRepository } from './memory/MemoryPatientRepository';
import { MemoryPrescriptionRepository } from './memory/MemoryPrescriptionRepository';
import { MemoryCalibrationRepository, MemorySessionRepository } from './memory/MemorySessionRepository';
import { MemoryStore } from './memory/MemoryStore';
import type { KeyValueStorage } from './memory/MemoryStore';

export interface DataLayerOptions {
  backend?: DataBackend;
  storage?: KeyValueStorage;
}

export async function createDataLayer(options: DataLayerOptions = {}): Promise<DataLayer> {
  const backend = options.backend ?? env.dataBackend;

  if (backend === 'firebase') {
    const [{ getFirebase }, { FirestorePatientRepository }, { FirestorePrescriptionRepository }, { FirebaseAuthService }, sessionModule, { FirestoreAccountRepository }] =
      await Promise.all([
        import('./firebase/firebaseApp'),
        import('./firebase/FirestorePatientRepository'),
        import('./firebase/FirestorePrescriptionRepository'),
        import('./firebase/FirebaseAuthService'),
        import('./firebase/FirestoreSessionRepository'),
        import('./firebase/FirestoreAccountRepository'),
      ]);
    const { auth, db } = getFirebase();
    return {
      mode: 'firebase',
      patients: new CachedPatientRepository(new FirestorePatientRepository(db)),
      prescriptions: new FirestorePrescriptionRepository(db),
      sessions: new sessionModule.FirestoreSessionRepository(db),
      calibrations: new sessionModule.FirestoreCalibrationRepository(db),
      auth: new FirebaseAuthService(auth, db),
      accounts: new FirestoreAccountRepository(db),
    };
  }

  const store = new MemoryStore(options.storage);
  return {
    mode: 'memory',
    patients: new CachedPatientRepository(new MemoryPatientRepository(store)),
    prescriptions: new MemoryPrescriptionRepository(store),
    sessions: new MemorySessionRepository(store),
    calibrations: new MemoryCalibrationRepository(store),
    auth: new MemoryAuthService(store),
    accounts: new MemoryAccountRepository(store),
  };
}
