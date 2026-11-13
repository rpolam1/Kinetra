import { useMemo, useState } from 'react';
import { getExercise, needsCalibration } from '../../domain';
import type { Patient, Prescription } from '../../domain';
import { useSearchResults } from '../../app/hooks/useSearchResults';
import { useData } from '../../app/providers/DataProvider';
import type { SessionParticipantInput } from '../../services/hub/types';
import { Button } from '../../ui/Button';
import { CheckboxField, TextField } from '../../ui/fields';
import { Alert, Avatar, Badge, Card, EmptyState, Spinner } from '../../ui/display';
import { rosterProblems, toParticipantInput } from './roster';
import type { RosterProblem } from './roster';

/** A person on today's roster with their prescription and anything that could stop them from being tracked. */
interface Entry {
  patient: Patient;
  prescription: Prescription | null;
  problems: RosterProblem[];
}

/** Picks who is in the room and starts the session. Blocking problems, such as missing consent, stop the start button. */
export function SessionSetup({ onStart, starting }: { onStart: (participants: SessionParticipantInput[], autoAdvance: boolean) => void; starting: boolean }) {
  const { patients, prescriptions, calibrations } = useData();
  const [text, setText] = useState('');
  const [roster, setRoster] = useState<Map<string, Entry>>(new Map());
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const found = useSearchResults(patients, text, 8);

  async function add(patient: Patient) {
    setAdding(patient.id);
    setAddError(null);
    try {
      // The prescription and calibrations are read now, so the problems list is correct at the moment the person is added
      const [rx, records] = await Promise.all([prescriptions.current(patient.id), calibrations.forPatient(patient.id)]);
      const calibrated = new Set(records.map((r) => r.exerciseId));
      const uncalibrated = (rx?.exercises ?? [])
        .map((e) => getExercise(e.exerciseId))
        .flatMap((d) => (d && needsCalibration(d) && !calibrated.has(d.id) ? [d.name] : []));
      setRoster((r) => new Map(r).set(patient.id, { patient, prescription: rx, problems: rosterProblems(patient, rx, uncalibrated) }));
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not load that patient');
    } finally {
      setAdding(null);
    }
  }

  // The list is kept as a map for quick lookups and turned into an array only for display
  const entries = useMemo(() => [...roster.values()], [roster]);
  const startable = entries.length > 0 && entries.every((e) => !e.problems.some((p) => p.blocking));

  function start() {
    onStart(entries.map((e) => toParticipantInput(e.patient, e.prescription!)), autoAdvance);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Add people" description="Search by name, code (P-0042) or tag (#12).">
        <TextField label="Search patients" name="search" value={text} onChange={setText} placeholder="Start typing a name…" />
        {!found.ready ? <Spinner /> : null}
        <ul className={`mt-3 min-h-[22rem] divide-y divide-slate-100 transition-opacity duration-200 ${found.pending ? 'opacity-70' : 'opacity-100'}`} aria-label="Search results" aria-busy={found.pending}>
          {found.rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-3"><Avatar name={`${p.firstName} ${p.lastName}`} size={32} /><span>{p.firstName} {p.lastName} <span className="text-sm text-slate-500">{p.code}</span></span></span>
              <Button size="sm" variant="secondary" icon={roster.has(p.id) ? 'check' : 'plus'} disabled={roster.has(p.id) || adding === p.id} onClick={() => void add(p)} aria-label={`Add ${p.firstName} ${p.lastName}`}>
                {roster.has(p.id) ? 'Added' : 'Add'}
              </Button>
            </li>
          ))}
        </ul>
        {addError ? <Alert tone="error">{addError}</Alert> : null}
      </Card>

      <Card title={`Today's roster (${entries.length})`} description="Everyone here is tracked by tag; the board shows only the name shown below.">
        {entries.length === 0 ? (
          <EmptyState title="Nobody added yet" icon="patients">Search on the left and press Add.</EmptyState>
        ) : (
          <ul className="space-y-3" aria-label="Roster">
            {entries.map(({ patient, prescription, problems }) => (
              <li key={patient.id} data-rise className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{patient.boardName} <span className="text-sm font-normal text-slate-500">{patient.code} · tag #{patient.tagId ?? '—'}</span></span>
                  <Button size="sm" variant="ghost" icon="remove" onClick={() => setRoster((r) => { const n = new Map(r); n.delete(patient.id); return n; })} aria-label={`Remove ${patient.boardName}`}>Remove</Button>
                </div>
                {prescription ? <p className="text-sm text-slate-600">{prescription.exercises.length} exercises</p> : null}
                {problems.map((p) => (
                  <p key={p.text} className="mt-1.5 flex flex-wrap items-center gap-2 text-sm"><Badge tone={p.blocking ? 'red' : 'amber'} icon={p.blocking ? 'blocked' : 'warning'}>{p.blocking ? 'Cannot start' : 'Note'}</Badge> {p.text}</p>
                ))}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-3">
          <CheckboxField label="Move people on automatically when they finish an exercise" name="auto" checked={autoAdvance} onChange={setAutoAdvance} />
          <Button onClick={start} disabled={!startable} loading={starting} icon="play">Start session</Button>
        </div>
      </Card>
    </div>
  );
}