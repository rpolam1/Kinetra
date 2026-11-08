import { useState } from 'react';
import { classifySearchQuery, MIN_NAME_QUERY_LENGTH } from '../../domain';
import { Link } from '../../app/router';
import { useAsync } from '../../app/hooks/useAsync';
import { useDebouncedValue } from '../../app/hooks/useDebouncedValue';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { DEFAULT_SEARCH_LIMIT } from '../../data/repositories';
import { buttonClass } from '../../ui/Button';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { CheckboxField, TextField } from '../../ui/fields';
import { PatientRow } from './PatientRow';

const DEBOUNCE_MS = 300;

export function PatientsPage() {
  const { patients } = useData();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const intent = classifySearchQuery(debounced);
  const searching = intent.kind !== 'empty';

  const result = useAsync(
    () => (searching ? patients.search(debounced, DEFAULT_SEARCH_LIMIT) : patients.recent(DEFAULT_SEARCH_LIMIT)),
    [patients, debounced, searching],
  );

  const rows = (result.data ?? []).filter((p) => includeArchived || p.status === 'active');
  const typedButTooShort = query.trim() !== '' && classifySearchQuery(query).kind === 'empty';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Program"
        title="Patients"
        description="Search by name, patient code (P-0042) or tag number (#12)."
        actions={
          can('patient:create') ? (
            <Link to="/patients/new" data-hover="button" className={buttonClass('primary', 'md')}>
              <span data-hover-icon className="inline-flex"><Icon name="addPerson" /></span>
              New patient
            </Link>
          ) : null
        }
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label="Search patients" name="search" value={query} onChange={setQuery} placeholder="e.g. Kowalski, Ana K, P-0042, #12" autoComplete="off" />
          <CheckboxField label="Include archived" name="includeArchived" checked={includeArchived} onChange={setIncludeArchived} />
        </div>
        {typedButTooShort ? <p className="mt-2 text-xs text-slate-500">Type at least {MIN_NAME_QUERY_LENGTH} characters.</p> : null}
      </Card>

      <Card title={searching ? `Results for “${debounced.trim()}”` : 'Recently updated'}>
        {result.error ? (
          <Alert tone="error" title="Could not load patients">
            {result.error.message}
          </Alert>
        ) : result.loading && result.data === null ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon={searching ? 'search' : 'patients'} title={searching ? 'No matching patients' : 'No patients yet'}>
            {searching ? 'Check the spelling, or search by code or tag number.' : can('patient:create') ? 'Create the first patient to get started.' : 'Ask an instructor to add patients.'}
          </EmptyState>
        ) : (
          <>
            <ul className="-mx-2 divide-y divide-slate-100" aria-label="Patients">
              {rows.map((p) => (
                <PatientRow key={p.id} patient={p} />
              ))}
            </ul>
            {rows.length >= DEFAULT_SEARCH_LIMIT ? <p className="mt-3 text-xs text-slate-500">Showing the first {DEFAULT_SEARCH_LIMIT}. Type more to narrow it down.</p> : null}
          </>
        )}
      </Card>
    </div>
  );
}
