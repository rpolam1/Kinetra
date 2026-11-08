import type { Role } from './types';

export type Action =
  | 'patient:view'
  | 'patient:create'
  | 'patient:edit'
  | 'patient:archive'
  | 'prescription:edit'
  | 'tag:manage'
  | 'hub:configure'
  | 'session:run'
  | 'user:manage';

const GRANTS: Readonly<Record<Role, readonly Action[]>> = {
  admin: [
    'patient:view',
    'patient:create',
    'patient:edit',
    'patient:archive',
    'prescription:edit',
    'tag:manage',
    'hub:configure',
    'session:run',
    'user:manage',
  ],
  instructor: [
    'patient:view',
    'patient:create',
    'patient:edit',
    'patient:archive',
    'prescription:edit',
    'tag:manage',
    'hub:configure',
    'session:run',
  ],
  // volunteers can look people up and help in sessions, not edit records
  volunteer: ['patient:view', 'session:run'],
};

export function can(role: Role | null, action: Action): boolean {
  return role !== null && GRANTS[role].includes(action);
}
