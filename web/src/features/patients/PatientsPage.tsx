import { useState } from 'react';
import { classifySearchQuery, MIN_NAME_QUERY_LENGTH } from '../../domain';
import { Link } from '../../app/router';
import { useSearchResults } from '../../app/hooks/useSearchResults';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { DEFAULT_SEARCH_LIMIT } from '../../data/repositories';
import { buttonClass } from '../../ui/Button';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { CheckboxField, TextField } from '../../ui/fields';
import { PatientRow } from './PatientRow';

export function PatientsPage() {
  const { patients } = useData();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const result = useSearchResults(patients, query, DEFAULT_SEARCH_LIMIT);
  const searching = result.searching;
  const rows = result.rows.filter((p) => includeArchived || p.status === 'active');
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
        <p aria-live="polite" className={`mt-2 h-4 text-xs text-slate-500 transition-opacity duration-200 ${typedButTooShort ? 'opacity-100' : 'opacity-0'}`}>
          Type at least {MIN_NAME_QUERY_LENGTH} characters.
        </p>
      </Card>

      <Card
        title={searching ? 'Results' : 'Recently updated'}
        actions={
          <span aria-hidden="true" className={`grid h-5 w-5 place-items-center text-slate-400 transition-opacity duration-200 ${result.pending ? 'opacity-100' : 'opacity-0'}`}>
            <Icon name="spinner" spin />
          </span>
        }
      >
        <div className="min-h-[26rem]">
          {result.error ? (
            <Alert tone="error" title="Could not load patients">
              {result.error.message}
            </Alert>
          ) : !result.ready ? (
            <Spinner />
          ) : rows.length === 0 && !result.pending ? (
            <EmptyState icon={searching ? 'search' : 'patients'} title={searching ? 'No matching patients' : 'No patients yet'}>
              {searching ? 'Check the spelling, or search by code or tag number.' : can('patient:create') ? 'Create the first patient to get started.' : 'Ask an instructor to add patients.'}
            </EmptyState>
          ) : (
            <div className={`transition-opacity duration-200 ${result.pending ? 'opacity-70' : 'opacity-100'}`}>
              <ul className="-mx-2 divide-y divide-slate-100" aria-label="Patients" aria-busy={result.pending}>
                {rows.map((p) => (
                  <PatientRow key={p.id} patient={p} />
                ))}
              </ul>
              {rows.length >= DEFAULT_SEARCH_LIMIT ? <p className="mt-3 text-xs text-slate-500">Showing the first {DEFAULT_SEARCH_LIMIT}. Type more to narrow it down.</p> : null}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}