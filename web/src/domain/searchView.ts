import { classifySearchQuery, normalizeText } from './patients';
import type { SearchIntent } from './patients';
import type { Patient } from './types';

/** A finished search, kept so the list can keep showing it while the next search loads. */
export interface SearchSnapshot {
  key: string;
  intent: SearchIntent;
  rows: readonly Patient[];
}

/** A string that is the same for searches that mean the same thing. */
export function searchKey(intent: SearchIntent): string {
  return JSON.stringify(intent);
}

/** Bundle a query with its rows. */
export function snapshotOf(query: string, rows: readonly Patient[]): SearchSnapshot {
  const intent = classifySearchQuery(query);
  return { key: searchKey(intent), intent, rows };
}

function matchesPrefix(patient: Patient, prefix: string): boolean {
  return patient.nameKey.startsWith(prefix) || patient.nameKeyAlt.startsWith(prefix);
}

/** Rows to show while a new search loads. A longer name prefix is answered by filtering the previous rows, so the list does not flash empty. */
export function interimRows(previous: SearchSnapshot | null, wanted: SearchIntent): readonly Patient[] | null {
  if (previous === null) return null;
  if (previous.key === searchKey(wanted)) return previous.rows;
  if (wanted.kind !== 'name') return previous.rows;
  const narrower = previous.intent.kind === 'empty' || (previous.intent.kind === 'name' && wanted.prefix.startsWith(previous.intent.prefix));
  if (!narrower) return previous.rows;
  const prefix = normalizeText(wanted.prefix);
  return previous.rows.filter((p) => matchesPrefix(p, prefix));
}