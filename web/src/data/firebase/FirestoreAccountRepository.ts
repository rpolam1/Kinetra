import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { AccountStatus, Role, UserAccount } from '../../domain';
import { DataError } from '../repositories';
import type { AccountRepository } from '../repositories';
import { readAccount } from './accountMapping';
import { guard, mapFirebaseError } from './errors';

const MAX_ACCOUNTS = 300;

export class FirestoreAccountRepository implements AccountRepository {
  constructor(private readonly db: Firestore) {}

  watch(onChange: (accounts: UserAccount[]) => void, onError: (error: Error) => void): () => void {
    const q = query(collection(this.db, 'users'), orderBy('createdAt', 'desc'), limit(MAX_ACCOUNTS));
    return onSnapshot(
      q,
      (snap) => onChange(snap.docs.map((d) => readAccount(d.id, d.data()))),
      (error) => onError(mapFirebaseError(error)),
    );
  }

  approve(uid: string, role: Role, actorUid: string): Promise<void> {
    return guard(() =>
      updateDoc(doc(this.db, 'users', uid), { role, status: 'approved', requestedRole: null, awaiting: false, decidedBy: actorUid, decidedAt: Date.now() }),
    );
  }

  reject(uid: string, actorUid: string): Promise<void> {
    return guard(async () => {
      const ref = doc(this.db, 'users', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new DataError('not_found', 'That account no longer exists');
      const pending = snap.data().status === 'pending';
      await updateDoc(ref, { ...(pending ? { status: 'rejected' } : {}), requestedRole: null, awaiting: false, decidedBy: actorUid, decidedAt: Date.now() });
    });
  }

  setRole(uid: string, role: Role, actorUid: string): Promise<void> {
    if (uid === actorUid) return Promise.reject(new DataError('permission', 'You cannot change your own role'));
    return guard(() => updateDoc(doc(this.db, 'users', uid), { role, requestedRole: null, awaiting: false, decidedBy: actorUid, decidedAt: Date.now() }));
  }

  setStatus(uid: string, status: Extract<AccountStatus, 'approved' | 'disabled'>, actorUid: string): Promise<void> {
    if (uid === actorUid) return Promise.reject(new DataError('permission', 'You cannot switch off your own account'));
    return guard(() => updateDoc(doc(this.db, 'users', uid), { status, decidedBy: actorUid, decidedAt: Date.now() }));
  }
}
