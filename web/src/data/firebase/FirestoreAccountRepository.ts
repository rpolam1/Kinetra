import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { AccountStatus, Role, UserAccount } from '../../domain';
import { DataError } from '../repositories';
import type { AccountRepository } from '../repositories';
import { readAccount } from './accountMapping';
import { guard, mapFirebaseError } from './errors';

// Enough for a clinic's team, and it keeps the live listener small
const MAX_ACCOUNTS = 300;

/** Account approval, stored in the users collection. */
export class FirestoreAccountRepository implements AccountRepository {
  constructor(private readonly db: Firestore) {}

  /** Listen to the newest accounts. Returns a function that stops listening. */
  watch(onChange: (accounts: UserAccount[]) => void, onError: (error: Error) => void): () => void {
    const q = query(collection(this.db, 'users'), orderBy('createdAt', 'desc'), limit(MAX_ACCOUNTS));
    return onSnapshot(
      q,
      (snap) => onChange(snap.docs.map((d) => readAccount(d.id, d.data()))),
      (error) => onError(mapFirebaseError(error)),
    );
  }

  /** Give the account a role and mark the request as decided. */
  approve(uid: string, role: Role, actorUid: string): Promise<void> {
    return guard(() =>
      updateDoc(doc(this.db, 'users', uid), { role, status: 'approved', requestedRole: null, awaiting: false, decidedBy: actorUid, decidedAt: Date.now() }),
    );
  }

  /** Decline a request. A new account is rejected, while for someone already approved only the upgrade request is cleared. */
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
    // Nobody can change their own role, so access cannot be removed or raised by accident
    if (uid === actorUid) return Promise.reject(new DataError('permission', 'You cannot change your own role'));
    return guard(() => updateDoc(doc(this.db, 'users', uid), { role, requestedRole: null, awaiting: false, decidedBy: actorUid, decidedAt: Date.now() }));
  }

  /** Switch an account on or off. */
  setStatus(uid: string, status: Extract<AccountStatus, 'approved' | 'disabled'>, actorUid: string): Promise<void> {
    if (uid === actorUid) return Promise.reject(new DataError('permission', 'You cannot switch off your own account'));
    return guard(() => updateDoc(doc(this.db, 'users', uid), { status, decidedBy: actorUid, decidedAt: Date.now() }));
  }
}
