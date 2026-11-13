import type { DocumentData } from 'firebase/firestore';
import type { AccountStatus, AuthUser, Role, UserAccount } from '../../domain';
import { ROLES } from '../../domain';

const STATUSES: readonly AccountStatus[] = ['pending', 'approved', 'rejected', 'disabled'];

/** Read a role from stored data and ignore anything that is not a real role. */
function asRole(value: unknown): Role | null {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

/** Read a status. A missing or unknown value counts as pending, the safest choice. */
function asStatus(value: unknown): AccountStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value) ? (value as AccountStatus) : 'pending';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Build an account from a stored document. Missing fields get safe defaults, and a role only counts once the account is approved. */
export function readAccount(uid: string, data: DocumentData | undefined): UserAccount {
  const d = data ?? {};
  const status = asStatus(d.status);
  return {
    uid,
    email: typeof d.email === 'string' ? d.email : '',
    displayName: typeof d.displayName === 'string' ? d.displayName : '',
    role: status === 'approved' ? asRole(d.role) : null,
    status,
    requestedRole: asRole(d.requestedRole),
    awaiting: d.awaiting === true,
    createdAt: asNumber(d.createdAt) ?? 0,
    decidedBy: typeof d.decidedBy === 'string' ? d.decidedBy : null,
    decidedAt: asNumber(d.decidedAt),
  };
}

/** The part of an account that the signed in person sees. */
export function toAuthUser(account: UserAccount): AuthUser {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    requestedRole: account.requestedRole,
  };
}

/** The document for a new account. It starts as pending with no role, and an admin has to approve it. */
export function newProfile(uid: string, email: string, displayName: string, requestedRole: Role, now: number): DocumentData {
  return {
    uid,
    email,
    displayName,
    role: null,
    status: 'pending',
    requestedRole,
    awaiting: true,
    createdAt: now,
    decidedBy: null,
    decidedAt: null,
  };
}
