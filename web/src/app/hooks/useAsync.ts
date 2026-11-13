import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Run async work whenever the dependencies change and track loading and error state. A slow earlier call cannot overwrite the result of a newer one. */
export function useAsync<T>(work: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  // Counts calls so a late response from an old call can be ignored
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    work().then(
      (data) => {
        if (run === latest.current) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (run === latest.current) {
          setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false });
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
