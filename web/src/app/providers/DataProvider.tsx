import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createDataLayer } from '../../data/createDataLayer';
import type { DataLayer } from '../../data/repositories';
import { browserStorage } from '../settingsStorage';
import { Alert, Spinner } from '../../ui/display';

const DataContext = createContext<DataLayer | null>(null);

export function useData(): DataLayer {
  const layer = useContext(DataContext);
  if (!layer) throw new Error('useData must be used inside <DataProvider>');
  return layer;
}

interface DataProviderProps {
  children: ReactNode;
  createLayer?: () => Promise<DataLayer>;
}

export function DataProvider({ children, createLayer }: DataProviderProps) {
  const [layer, setLayer] = useState<DataLayer | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const make = createLayer ?? (() => createDataLayer({ storage: browserStorage() ?? undefined }));
    make().then(
      (l) => !cancelled && setLayer(l),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      cancelled = true;
    };
  }, [createLayer]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="error" title="Could not start the data layer">
          {error.message}
        </Alert>
      </div>
    );
  }
  if (!layer) return <Spinner label="Starting…" />;
  return <DataContext.Provider value={layer}>{children}</DataContext.Provider>;
}
