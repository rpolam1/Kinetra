import { useRef } from 'react';
import { classifySearchQuery, interimRows, searchKey, snapshotOf } from '../../domain';
import type { Patient, SearchSnapshot } from '../../domain';
import type { PatientRepository } from '../../data/repositories';
import { useAsync } from './useAsync';
import { useDebouncedValue } from './useDebouncedValue';

const DEFAULT_DEBOUNCE_MS = 180;

export interface SearchResults {
  rows: readonly Patient[];
  searching: boolean;
  pending: boolean;
  ready: boolean;
  error: Error | null;
}

export function useSearchResults(patients: PatientRepository, rawQuery: string, limit: number, debounceMs: number = DEFAULT_DEBOUNCE_MS): SearchResults {
  const typed = rawQuery.trim();
  const debounced = useDebouncedValue(typed, debounceMs);
  const wanted = classifySearchQuery(typed);
  const searching = wanted.kind !== 'empty';
  const lookup = classifySearchQuery(debounced);
  const last = useRef<SearchSnapshot | null>(null);

  const result = useAsync(async () => {
    const rows = lookup.kind !== 'empty' ? await patients.search(debounced, limit) : await patients.recent(limit);
    return snapshotOf(debounced, rows);
  }, [patients, debounced, limit]);

  if (result.data) last.current = result.data;

  const settled = result.data !== null && result.data.key === searchKey(wanted);
  const rows = settled ? result.data!.rows : (interimRows(last.current, wanted) ?? []);

  return { rows, searching, pending: !settled && !result.error, ready: last.current !== null, error: result.error };
}