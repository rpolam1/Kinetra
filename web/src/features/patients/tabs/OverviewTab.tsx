import { DOSE_GUIDELINES, computeAge, getExercise, hasBetaBlocker, heartRateZone } from '../../../domain';
import type { Patient } from '../../../domain';
import { Link } from '../../../app/router';
import { useAsync } from '../../../app/hooks/useAsync';
import { useData } from '../../../app/providers/DataProvider';
import { Alert, Card, DefinitionList } from '../../../ui/display';
import { Icon } from '../../../ui/Icon';
import { SessionHistory } from '../../history/SessionHistory';
import { AID_LABELS, FALLS_LABELS, REFERRAL_LABELS, SIDE_LABELS, STREAM_LABELS, SUPERVISION_LABELS } from '../labels';

export function OverviewTab({ patient }: { patient: Patient }) {
  const { prescriptions } = useData();
  const rx = useAsync(() => prescriptions.current(patient.id), [prescriptions, patient.id]);
  const age = computeAge(patient.dateOfBirth);
  const zone = heartRateZone({
    age,
    restingHr: patient.restingHr,
    maxHr: patient.maxHr,
    lowPct: DOSE_GUIDELINES.cardioIntensityPct.low,
    highPct: DOSE_GUIDELINES.cardioIntensityPct.high,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Summary">
          <DefinitionList
            items={[
              { term: 'Date of birth', detail: `${patient.dateOfBirth}${age !== null ? ` (${age})` : ''}` },
              { term: 'Program', detail: STREAM_LABELS[patient.stream] },
              { term: 'Referred by', detail: REFERRAL_LABELS[patient.referralSource] },
              { term: 'Diagnoses', detail: patient.diagnoses.length ? patient.diagnoses.join('; ') : '—' },
              { term: 'Mobility aid', detail: AID_LABELS[patient.mobilityAid] },
              { term: 'Falls risk', detail: FALLS_LABELS[patient.fallsRisk] },
              { term: 'Supervision', detail: SUPERVISION_LABELS[patient.supervision] },
              { term: 'Affected side', detail: SIDE_LABELS[patient.affectedSide] },
              { term: 'Precautions', detail: patient.precautions || '—' },
              { term: 'Goals', detail: patient.goals || '—' },
            ]}
          />
        </Card>
        <SessionHistory patientId={patient.id} />
      </div>

      <div className="space-y-6">
        <Card title="Current prescription">
          {rx.loading && rx.data === null ? null : rx.data ? (
            <div className="space-y-2 text-sm">
              <p>
                Version {rx.data.version}: {rx.data.exercises.length} exercise{rx.data.exercises.length === 1 ? '' : 's'}
              </p>
              <ul className="list-disc pl-5 text-slate-700">
                {rx.data.exercises.slice(0, 6).map((e) => (
                  <li key={e.exerciseId}>{getExercise(e.exerciseId)?.name ?? e.exerciseId}</li>
                ))}
              </ul>
              <Link to={`/patients/${patient.id}/prescription`} className="text-teal-800 underline">Open prescription</Link>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-slate-600">No prescription yet.</p>
              <Link to={`/patients/${patient.id}/prescription`} className="text-teal-800 underline">Create one</Link>
            </div>
          )}
        </Card>

        <Card title="Cardio target">
          {hasBetaBlocker(patient) ? (
            <Alert tone="warning">On a beta-blocker: use perceived exertion, not heart-rate zones.</Alert>
          ) : zone ? (
            <p className="text-sm">
              <strong>
                {zone.lowBpm}-{zone.highBpm} bpm
              </strong>{' '}
              (40-60% of reserve; {zone.maxHrSource} max {zone.maxHr})
            </p>
          ) : (
            <p className="text-sm text-slate-600">Enter resting heart rate in Details to calculate a target.</p>
          )}
        </Card>

        <Card title="Consent">
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2"><Icon name={patient.consent.exercise ? 'success' : 'error'} className={patient.consent.exercise ? 'text-emerald-600' : 'text-red-600'} /> Exercise program</li>
            <li className="flex items-center gap-2"><Icon name={patient.consent.cameraTracking ? 'success' : 'error'} className={patient.consent.cameraTracking ? 'text-emerald-600' : 'text-red-600'} /> Camera movement tracking</li>
            {patient.consent.signedOn ? <li className="text-slate-500">Signed {patient.consent.signedOn}</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
