import type { AuthUser, Role, SignUpInput, UserAccount } from '../../domain';
import { validateSignUp } from '../../domain';
import { DataError } from '../repositories';
import type { AuthService } from '../repositories';
import { MemoryStore } from './MemoryStore';
import type { StoredUser } from './MemoryStore';

/** The shared password for the built in demo accounts. */
export const DEMO_PASSWORD = 'demo';
export const DEMO_ACCOUNTS: Readonly<Record<string, Role>> = {
  'instructor@demo.test': 'instructor',
  'admin@demo.test': 'admin',
  'volunteer@demo.test': 'volunteer',
};

/** Display names for the demo accounts. */
const NAMES: Readonly<Record<Role, string>> = { admin: 'Demo Admin', instructor: 'Demo Instructor', volunteer: 'Demo Volunteer' };

/** The part of an account the signed in person sees. A role only counts once the account is approved. */
export function toAuthUser(user: UserAccount): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.status === 'approved' ? user.role : null,
    status: user.status,
    requestedRole: user.requestedRole,
  };
}

/** Sign in against accounts kept in the browser. This is for demos and tests, so passwords are stored in plain text. */
export class MemoryAuthService implements AuthService {
  readonly demo = true;
  private user: AuthUser | null = null;
  private listeners = new Set<(user: AuthUser | null) => void>();

  constructor(private readonly store: MemoryStore = new MemoryStore()) {
    this.seedDemoAccounts();
    // admin decisions reach a signed-in user right away, like firebase
    store.watchUsers(() => this.refresh());
  }

  current(): AuthUser | null {
    return this.user;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const normalized = email.trim().toLowerCase();
    const found = [...this.store.users.values()].find((u) => u.email === normalized);
    if (!found || found.password !== password) {
      throw new DataError('permission', 'Wrong email or password');
    }
    this.user = toAuthUser(found);
    this.emit();
    return this.user;
  }

  async signUp(input: SignUpInput): Promise<AuthUser> {
    const errors = validateSignUp(input);
    const first = Object.values(errors)[0];
    if (first) throw new DataError('invalid', first);
    const email = input.email.trim().toLowerCase();
    if ([...this.store.users.values()].some((u) => u.email === email)) {
      throw new DataError('conflict', 'An account with this email already exists. Try signing in.');
    }
    const account: StoredUser = {
      uid: `user-${this.store.nextId('')}`,
      email,
      displayName: input.displayName.trim(),
      role: null,
      status: 'pending',
      requestedRole: input.requestedRole,
      awaiting: true,
      createdAt: this.store.now(),
      decidedBy: null,
      decidedAt: null,
      password: input.password,
    };
    this.store.users.set(account.uid, account);
    this.user = toAuthUser(account);
    this.store.usersChanged();
    this.emit();
    return this.user;
  }

  async requestRole(role: Role): Promise<void> {
    const me = this.user && this.store.users.get(this.user.uid);
    if (!me) throw new DataError('permission', 'Sign in first');
    me.requestedRole = role;
    me.awaiting = true;
    this.store.usersChanged();
  }

  async signOut(): Promise<void> {
    this.user = null;
    this.emit();
  }

  subscribe(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.user);
    return () => this.listeners.delete(listener);
  }

  /** Add the demo accounts for each role if they are not there yet. */
  private seedDemoAccounts(): void {
    for (const [email, role] of Object.entries(DEMO_ACCOUNTS)) {
      if ([...this.store.users.values()].some((u) => u.email === email)) continue;
      const uid = `demo-${role}`;
      this.store.users.set(uid, {
        uid,
        email,
        displayName: NAMES[role],
        role,
        status: 'approved',
        requestedRole: null,
        awaiting: false,
        createdAt: 0,
        decidedBy: 'system',
        decidedAt: 0,
        password: DEMO_PASSWORD,
      });
    }
  }

  /** Re-read the signed in person after an admin changes their account. */
  private refresh(): void {
    if (!this.user) return;
    const latest = this.store.users.get(this.user.uid);
    this.user = latest ? toAuthUser(latest) : null;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.user);
  }
}
