import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { MIN_PASSWORD_LENGTH, ROLE_INFO, SIGNUP_ROLES, validateSignUp } from '../../domain';
import type { Role } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { TextField } from '../../ui/fields';

const ROLE_ICON: Record<Role, IconName> = { volunteer: 'volunteer', instructor: 'instructor', admin: 'team' };

export function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState<Role>('volunteer');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateSignUp({ displayName, email, password, confirmPassword, requestedRole });
    setErrors(found);
    setError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await signUp({ displayName, email, password, requestedRole });
      // status is pending now, so the waiting screen shows
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[2rem] font-semibold leading-tight tracking-tight text-slate-900">Request access</h2>
        <p className="mt-2 text-[15px] text-slate-600">Create your Kinetra account. An administrator approves it before you can see any patient information.</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Request access" noValidate>
        <TextField label="Full name" name="displayName" required value={displayName} autoComplete="name" error={errors.displayName} onChange={setDisplayName} />
        <TextField label="Email" name="email" type="email" required value={email} autoComplete="username" error={errors.email} onChange={setEmail} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Password" name="password" type="password" required value={password} autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`} error={errors.password} onChange={setPassword} />
          <TextField label="Confirm password" name="confirmPassword" type="password" required value={confirmPassword} autoComplete="new-password" error={errors.confirmPassword} onChange={setConfirmPassword} />
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-slate-700">What will you do?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {SIGNUP_ROLES.map((role) => {
              const selected = requestedRole === role;
              return (
                <label
                  key={role}
                  data-hover="lift"
                  className={`relative block rounded-xl border bg-white p-3.5 transition-colors ${selected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-300 hover:border-slate-400'}`}
                >
                  <input type="radio" name="requestedRole" value={role} checked={selected} onChange={() => setRequestedRole(role)} className="peer sr-only" />
                  <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-500" aria-hidden="true" />
                  <span className="flex items-center gap-2.5">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg ${selected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <Icon name={ROLE_ICON[role]} />
                    </span>
                    <span className="font-semibold text-slate-900">{ROLE_INFO[role].label}</span>
                    {selected ? <Icon name="check" className="ml-auto text-teal-600" /> : null}
                  </span>
                  <span className="mt-2 block text-[13px] leading-snug text-slate-600">{ROLE_INFO[role].can.join('. ')}.</span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">Need administrator access? Sign up first, then ask for it from your account page once you are approved.</p>
        </fieldset>

        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" loading={busy} iconAfter="next" className="w-full">Send request</Button>
      </form>

      <p className="text-sm text-slate-600">
        Already approved?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-teal-700 underline decoration-teal-300 underline-offset-4 hover:text-teal-600">
          Sign in
        </button>
      </p>
    </div>
  );
}
