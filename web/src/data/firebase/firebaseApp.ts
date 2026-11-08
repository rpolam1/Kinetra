import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { requireFirebaseConfig } from '../../config/env';

export function getFirebase() {
  const config = requireFirebaseConfig();
  const app = getApps()[0] ?? initializeApp(config);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
