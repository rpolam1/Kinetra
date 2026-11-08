import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserAccount } from '../../domain';
import { awaitingKind, sortAccounts } from '../../domain';
import { useAuth } from './AuthProvider';
import { useData } from './DataProvider';

interface AccountsContextValue {
  accounts: UserAccount[];
  awaitingCount: number;
  loading: boolean;
  error: string | null;
}

const EMPTY: AccountsContextValue = { accounts: [], awaitingCount: 0, loading: false, error: null };
const AccountsContext = createContext<AccountsContextValue>(EMPTY);

export function useAccounts(): AccountsContextValue {
  return useContext(AccountsContext);
}

export function AccountsProvider({ children }: { children: ReactNode }) {
  const { accounts: repo } = useData();
  const { can } = useAuth();
  const allowed = can('user:manage');
  const [list, setList] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(allowed);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      setList([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    return repo.watch(
      (accounts) => {
        setList(accounts);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [repo, allowed]);

  const value = useMemo<AccountsContextValue>(() => {
    if (!allowed) return EMPTY;
    const accounts = sortAccounts(list);
    return { accounts, awaitingCount: accounts.filter((a) => awaitingKind(a) !== null).length, loading, error };
  }, [allowed, list, loading, error]);

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}
