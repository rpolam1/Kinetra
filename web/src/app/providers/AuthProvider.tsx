import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { can as roleCan } from '../../domain';
import type { Action, AuthUser, Role, SignUpInput } from '../../domain';
import { useData } from './DataProvider';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  demo: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  requestRole: (role: Role) => Promise<void>;
  signOut: () => Promise<void>;
  can: (action: Action) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useData();
  const [user, setUser] = useState<AuthUser | null>(auth.current());
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      auth.subscribe((next) => {
        setUser(next);
        setLoading(false);
      }),
    [auth],
  );

  const signIn = useCallback(async (email: string, password: string) => void (await auth.signIn(email, password)), [auth]);
  const signUp = useCallback(async (input: SignUpInput) => void (await auth.signUp(input)), [auth]);
  const requestRole = useCallback((role: Role) => auth.requestRole(role), [auth]);
  const signOut = useCallback(() => auth.signOut(), [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, demo: auth.demo, signIn, signUp, requestRole, signOut, can: (action) => roleCan(user?.role ?? null, action) }),
    [user, loading, auth.demo, signIn, signUp, requestRole, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
