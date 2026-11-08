import { useState } from 'react';
import { useAccounts } from '../../app/providers/AccountsProvider';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { ROLES, ROLE_INFO, STATUS_LABELS, awaitingKind, requestSummary } from '../../domain';
import type { Role, UserAccount } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert, Avatar, Badge, Card, EmptyState, PageHeader, Spinner } from '../../ui/display';
import type { Tone } from '../../ui/display';
import { timeAgo } from '../../ui/format';

const STATUS_TONE: Record<UserAccount['status'], Tone> = { pending: 'amber', approved: 'green', rejected: 'red', disabled: 'slate' };

function roleOptions(): { value: Role; label: string }[] {
  return ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label }));
}

function RoleSelect({ label, value, disabled, onChange }: { label: string; value: Role; disabled?: boolean; onChange: (role: Role) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Role)}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-card hover:border-slate-400 focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-500"
    >
      {roleOptions().map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function TeamPage() {
  const { can, user } = useAuth();
  const { accounts: repo } = useData();
  const { accounts, loading, error } = useAccounts();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Role>>({});

  if (!can('user:manage') || !user) {
    return <Alert tone="warning" title="Only administrators can manage the team" />;
  }
  const me = user.uid;

  async function act(uid: string, done: string, work: () => Promise<void>) {
    setBusy(uid);
    try {
      await work();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const waiting = accounts.filter((a) => awaitingKind(a) !== null);
  const name = (a: UserAccount) => a.displayName || a.email;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="Team" description="Approve new accounts, answer requests for more access, and change anyone's role." />

      {error ? <Alert tone="error" title="Could not load the team">{error}</Alert> : null}
      {loading && accounts.length === 0 ? <Spinner /> : null}

      <Card title={`Waiting for a decision (${waiting.length})`} description="New accounts cannot see anything until you approve them.">
        {waiting.length === 0 ? (
          <EmptyState title="Nothing is waiting" icon="success">New requests show up here the moment someone signs up.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200" aria-label="Requests waiting">
            {waiting.map((a) => {
              const role = picked[a.uid] ?? a.requestedRole ?? 'volunteer';
              const upgrade = awaitingKind(a) === 'upgrade';
              return (
                <li key={a.uid} data-rise className="flex flex-wrap items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                  <Avatar name={name(a)} size={40} tone={upgrade ? 'bg-indigo-100 text-indigo-900' : 'bg-amber-100 text-amber-900'} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{name(a)} {upgrade ? <Badge tone="violet" icon="up">Upgrade</Badge> : <Badge tone="amber" icon="pendingUser">New</Badge>}</p>
                    <p className="truncate text-sm text-slate-600">{a.email}</p>
                    <p className="text-sm text-slate-700">{requestSummary(a)} <span className="text-slate-500">· {timeAgo(a.createdAt)}</span></p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RoleSelect label={`Role for ${name(a)}`} value={role} disabled={busy === a.uid} onChange={(r) => setPicked((p) => ({ ...p, [a.uid]: r }))} />
                    <Button size="sm" icon="check" loading={busy === a.uid} aria-label={`Approve ${name(a)}`} onClick={() => void act(a.uid, `${name(a)} is now ${ROLE_INFO[role].label.toLowerCase()}`, () => repo.approve(a.uid, role, me))}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" icon="close" disabled={busy === a.uid} aria-label={`Decline ${name(a)}`} onClick={() => void act(a.uid, `Declined ${name(a)}`, () => repo.reject(a.uid, me))}>
                      Decline
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={`Everyone (${accounts.length})`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-slate-500">
                <th className="eyebrow px-5 py-2 font-semibold">Person</th>
                <th className="eyebrow px-3 py-2 font-semibold">Role</th>
                <th className="eyebrow px-3 py-2 font-semibold">Status</th>
                <th className="eyebrow px-5 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((a) => {
                const self = a.uid === me;
                const active = a.status === 'approved';
                return (
                  <tr key={a.uid} data-rise>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={name(a)} size={34} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{name(a)}{self ? <span className="ml-2 text-xs font-normal text-slate-500">(you)</span> : null}</p>
                          <p className="truncate text-xs text-slate-500">{a.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {active ? (
                        <RoleSelect label={`Role of ${name(a)}`} value={a.role ?? 'volunteer'} disabled={self || busy === a.uid} onChange={(r) => void act(a.uid, `${name(a)} is now ${ROLE_INFO[r].label.toLowerCase()}`, () => repo.setRole(a.uid, r, me))} />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABELS[a.status]}</Badge></td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {active && a.role === 'instructor' ? (
                          <Button size="sm" variant="secondary" icon="team" disabled={busy === a.uid} aria-label={`Make ${name(a)} an administrator`} onClick={() => void act(a.uid, `${name(a)} is now an administrator`, () => repo.setRole(a.uid, 'admin', me))}>
                            Make admin
                          </Button>
                        ) : null}
                        {!self && active ? (
                          <Button size="sm" variant="ghost" icon="disabledUser" disabled={busy === a.uid} aria-label={`Switch off ${name(a)}`} onClick={() => void act(a.uid, `Switched off ${name(a)}`, () => repo.setStatus(a.uid, 'disabled', me))}>
                            Switch off
                          </Button>
                        ) : null}
                        {a.status === 'rejected' ? (
                          <Button size="sm" variant="secondary" icon="check" disabled={busy === a.uid} aria-label={`Approve ${name(a)} after all`} onClick={() => void act(a.uid, `${name(a)} is now volunteer`, () => repo.approve(a.uid, 'volunteer', me))}>
                            Approve as volunteer
                          </Button>
                        ) : null}
                        {a.status === 'disabled' ? (
                          <Button size="sm" variant="secondary" icon="refresh" disabled={busy === a.uid} aria-label={`Switch on ${name(a)}`} onClick={() => void act(a.uid, `Switched on ${name(a)}`, () => repo.setStatus(a.uid, 'approved', me))}>
                            Switch on
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
