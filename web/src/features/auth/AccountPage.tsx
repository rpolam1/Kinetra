import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { ROLE_INFO, STATUS_LABELS, upgradeOptions } from '../../domain';
import type { Role } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert, Avatar, Badge, Card, PageHeader } from '../../ui/display';
import { SelectField } from '../../ui/fields';

/** The signed in person's account. Shows what their role allows and lets them ask an administrator for more access. */
export function AccountPage() {
  const { user, requestRole, signOut } = useAuth();
  const toast = useToast();
  const options = upgradeOptions(user?.role ?? null);
  const [wanted, setWanted] = useState<Role | ''>('');
  const [busy, setBusy] = useState(false);

  if (!user || !user.role) return null;
  const role = user.role;
  const choice: Role | undefined = wanted !== '' ? wanted : options[0];

  async function send() {
    if (!choice) return;
    setBusy(true);
    try {
      await requestRole(choice);
      toast.success(`Asked an administrator for ${ROLE_INFO[choice].label.toLowerCase()} access`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Your account" description="What you can do here, and how to ask for more access." />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.displayName || user.email} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-slate-900" data-testid="account-name">{user.displayName || user.email}</p>
            <p className="text-sm text-slate-600">{user.email}</p>
          </div>
          <div className="flex gap-2">
            <Badge tone="blue">{ROLE_INFO[role].label}</Badge>
            <Badge tone="green">{STATUS_LABELS[user.status]}</Badge>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-200 pt-4">
          <p className="eyebrow text-slate-500">As {ROLE_INFO[role].label.toLowerCase()} you can</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ROLE_INFO[role].can.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-slate-800">
                <span className="mt-1 text-teal-600"><svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg></span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {options.length > 0 ? (
        <Card title="Ask for more access" description="An administrator reviews every request. Your current access stays the same until they approve.">
          {user.requestedRole ? (
            <Alert tone="info" title="Request sent">
              You asked for {ROLE_INFO[user.requestedRole].label.toLowerCase()} access. It is waiting for an administrator.
            </Alert>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-64">
                <SelectField label="I would like to be" name="wantedRole" value={choice ?? options[0]!} onChange={setWanted} options={options.map((r) => ({ value: r, label: ROLE_INFO[r].label }))} />
              </div>
              <Button onClick={() => void send()} loading={busy} icon="key">Request access</Button>
            </div>
          )}
        </Card>
      ) : null}

      <div>
        <Button variant="secondary" icon="signOut" onClick={() => void signOut()}>Sign out</Button>
      </div>
    </div>
  );
}
