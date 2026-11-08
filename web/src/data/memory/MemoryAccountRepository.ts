import type { AccountStatus, Role, UserAccount } from '../../domain';
import { DataError } from '../repositories';
import type { AccountRepository } from '../repositories';
import { MemoryStore } from './MemoryStore';

export class MemoryAccountRepository implements AccountRepository {
  constructor(private readonly store: MemoryStore) {}

  watch(onChange: (accounts: UserAccount[]) => void, _onError: (error: Error) => void): () => void {
    const emit = () => onChange([...this.store.users.values()].map(({ password: _password, ...account }) => ({ ...account })));
    emit();
    return this.store.watchUsers(emit);
  }

  async approve(uid: string, role: Role, actorUid: string): Promise<void> {
    const user = this.mustGet(uid);
    user.role = role;
    user.status = 'approved';
    this.decided(user, actorUid);
  }

  async reject(uid: string, actorUid: string): Promise<void> {
    const user = this.mustGet(uid);
    if (user.status === 'pending') user.status = 'rejected';
    this.decided(user, actorUid);
  }

  async setRole(uid: string, role: Role, actorUid: string): Promise<void> {
    const user = this.mustGet(uid);
    if (uid === actorUid) throw new DataError('permission', 'You cannot change your own role');
    user.role = role;
    this.decided(user, actorUid);
  }

  async setStatus(uid: string, status: Extract<AccountStatus, 'approved' | 'disabled'>, actorUid: string): Promise<void> {
    const user = this.mustGet(uid);
    if (uid === actorUid) throw new DataError('permission', 'You cannot switch off your own account');
    user.status = status;
    this.decided(user, actorUid);
  }

  private mustGet(uid: string) {
    const user = this.store.users.get(uid);
    if (!user) throw new DataError('not_found', 'That account no longer exists');
    return user;
  }

  private decided(user: { requestedRole: Role | null; awaiting: boolean; decidedBy: string | null; decidedAt: number | null }, actorUid: string): void {
    user.requestedRole = null;
    user.awaiting = false;
    user.decidedBy = actorUid;
    user.decidedAt = this.store.now();
    this.store.usersChanged();
  }
}
