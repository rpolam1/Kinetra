import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../data/memory/MemoryAuthService';
import { ROLE_INFO } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/display';
import { TextField } from '../../ui/fields';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Could not sign in';
}

export function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const { signIn, demo } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (mail: string, pass: string) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(mail, pass);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void attempt(email, password);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[2rem] font-semibold leading-tight tracking-tight text-slate-900">Sign in to Kinetra</h2>
        <p className="mt-2 text-[15px] text-slate-600">Use the account your administrator approved.</p>
      </div>

      <form onSubmit={submit} className="space-y-4" aria-label="Sign in">
        <TextField label="Email" name="email" type="email" required value={email} autoComplete="username" onChange={setEmail} />
        <TextField label="Password" name="password" type="password" required value={password} autoComplete="current-password" onChange={setPassword} />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" loading={busy} disabled={!email || !password} iconAfter="next" className="w-full">Sign in</Button>
      </form>

      <p className="text-sm text-slate-600">
        No account yet?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-teal-700 underline decoration-teal-300 underline-offset-4 hover:text-teal-600">
          Request access
        </button>
        . An administrator approves every new account.
      </p>

      {demo ? (
        <div className="border-t border-slate-200 pt-5">
          <p className="text-sm font-semibold text-slate-800">Try the demo</p>
          <p className="mt-1 text-sm text-slate-600">
            Everything stays in this browser. Every demo account uses the password <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">{DEMO_PASSWORD}</code>.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {Object.entries(DEMO_ACCOUNTS).map(([mail, role]) => (
              <Button key={mail} size="sm" variant="secondary" icon={role === 'admin' ? 'team' : role === 'instructor' ? 'instructor' : 'volunteer'} onClick={() => void attempt(mail, DEMO_PASSWORD)} aria-label={`Sign in as ${role}`} title={ROLE_INFO[role].summary} className="w-full justify-center">
                {role === 'admin' ? 'Admin' : ROLE_INFO[role].label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
