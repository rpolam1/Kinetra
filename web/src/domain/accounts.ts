import type { AccountStatus, Role, UserAccount } from './types';

export const ROLES: readonly Role[] = ['volunteer', 'instructor', 'admin'];

export interface RoleInfo {
  label: string;
  summary: string;
  can: readonly string[];
}

export const ROLE_INFO: Readonly<Record<Role, RoleInfo>> = {
  volunteer: {
    label: 'Volunteer',
    summary: 'Helps during sessions',
    can: ['Look up patients', 'Run and watch live sessions'],
  },
  instructor: {
    label: 'Instructor',
    summary: 'Runs the program',
    can: ['Everything a volunteer can do', 'Create and edit patients', 'Prescribe exercises and calibrate form', 'Manage tags and the hub'],
  },
  admin: {
    label: 'Administrator',
    summary: 'Manages the team',
    can: ['Everything an instructor can do', 'Approve new accounts', 'Change anyone\'s role', 'Switch accounts off'],
  },
};

export const SIGNUP_ROLES: readonly Role[] = ['volunteer', 'instructor'];

export const STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  pending: 'Waiting for approval',
  approved: 'Active',
  rejected: 'Declined',
  disabled: 'Switched off',
};

export const MIN_PASSWORD_LENGTH = 8;

export interface SignUpInput {
  displayName: string;
  email: string;
  password: string;
  requestedRole: Role;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignUp(input: SignUpInput & { confirmPassword?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.displayName.trim().length < 2) errors.displayName = 'Enter your full name';
  if (input.displayName.trim().length > 80) errors.displayName = 'Keep the name under 80 characters';
  if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = 'Enter a valid email address';
  if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  else if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) errors.confirmPassword = 'The passwords do not match';
  if (!SIGNUP_ROLES.includes(input.requestedRole)) errors.requestedRole = 'Choose volunteer or instructor';
  return errors;
}

export function upgradeOptions(role: Role | null): Role[] {
  if (role === null) return [];
  return ROLES.filter((r) => ROLES.indexOf(r) > ROLES.indexOf(role));
}

export type AwaitingKind = 'new' | 'upgrade';

export function awaitingKind(account: Pick<UserAccount, 'awaiting' | 'status'>): AwaitingKind | null {
  if (!account.awaiting) return null;
  return account.status === 'pending' ? 'new' : 'upgrade';
}

export function sortAccounts(accounts: readonly UserAccount[]): UserAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
    if (a.awaiting && b.awaiting) return a.createdAt - b.createdAt;
    return (a.displayName || a.email).localeCompare(b.displayName || b.email);
  });
}

export function requestSummary(account: Pick<UserAccount, 'awaiting' | 'status' | 'requestedRole' | 'role'>): string {
  const kind = awaitingKind(account);
  const wanted = account.requestedRole ? ROLE_INFO[account.requestedRole].label.toLowerCase() : 'a role';
  if (kind === 'new') return `Wants to join as ${wanted}`;
  if (kind === 'upgrade') return `Currently ${account.role ? ROLE_INFO[account.role].label.toLowerCase() : 'no role'}; asks to become ${wanted}`;
  return '';
}
