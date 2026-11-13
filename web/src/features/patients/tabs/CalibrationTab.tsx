import { useState } from 'react';
import { getExercise, needsCalibration } from '../../../domain';
import type { CalibrationRecord, Patient } from '../../../domain';
import { useAsync } from '../../../app/hooks/useAsync';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useData } from '../../../app/providers/DataProvider';
import { Button } from '../../../ui/Button';
import { Alert, Badge, Card, EmptyState, Spinner } from '../../../ui/display';
import { CalibrationPanel } from '../../calibration/CalibrationPanel';
import { TrackingBadge } from '../../prescriptions/TrackingBadge';

/** Formats a timestamp as a short local date. */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Shows which prescribed exercises are calibrated and lets staff run a calibration for the ones that are not. */
export function CalibrationTab({ patient }: { patient: Patient }) {
  const { prescriptions, calibrations } = useData();
  const { can } = useAuth();
  const rx = useAsync(() => prescriptions.current(patient.id), [prescriptions, patient.id]);
  const records = useAsync(() => calibrations.forPatient(patient.id), [calibrations, patient.id]);
  const [active, setActive] = useState<string | null>(null);

  if ((rx.loading && rx.data === null) || (records.loading && records.data === null)) return <Spinner />;
  // Only exercises on the current prescription are listed, since nothing else will be tracked
  const lines = (rx.data?.exercises ?? []).flatMap((e) => {
    const def = getExercise(e.exerciseId);
    return def ? [{ def }] : [];
  });
  // Records are grouped by exercise because one exercise can be calibrated once per camera
  const byExercise = new Map<string, CalibrationRecord[]>();
  for (const r of records.data ?? []) byExercise.set(r.exerciseId, [...(byExercise.get(r.exerciseId) ?? []), r]);
  // Calibration needs the camera, so it also depends on the patient having consented to tracking
  const canRun = can('session:run') && patient.consent.cameraTracking;

  return (
    <div className="space-y-6">
      {!patient.consent.cameraTracking ? (
        <Alert tone="warning" title="Camera tracking consent is not recorded">
          Record consent in Details before calibrating or tracking this patient.
        </Alert>
      ) : null}

      {active ? (
        <CalibrationPanel
          patient={patient}
          exerciseId={active}
          onClose={() => setActive(null)}
          onSaved={() => records.reload()}
        />
      ) : null}

      <Card title="Calibration status" description="Each form-scored exercise is calibrated once from this patient's own good reps, on the camera they will exercise in front of.">
        {lines.length === 0 ? (
          <EmptyState title="Nothing to calibrate yet">Prescribe exercises first, then calibrate the form-scored ones here.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label="Exercises to calibrate">
            {lines.map(({ def }) => {
              const done = byExercise.get(def.id) ?? [];
              return (
                <li key={def.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{def.name}</span>
                    <TrackingBadge mode={def.tracking} />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {!needsCalibration(def) ? (
                      <Badge tone="green">No calibration needed</Badge>
                    ) : done.length === 0 ? (
                      <Badge tone="amber">Not calibrated</Badge>
                    ) : (
                      done.map((r) => <Badge key={r.slot} tone="green">{`${r.cameraId}: ${r.keptReps} reps, ${formatDate(r.calibratedAt)}`}</Badge>)
                    )}
                    {needsCalibration(def) && canRun ? (
                      <Button size="sm" variant={done.length === 0 ? 'primary' : 'secondary'} icon="video" onClick={() => setActive(def.id)} aria-label={`${done.length === 0 ? 'Calibrate' : 'Recalibrate'} ${def.name}`}>
                        {done.length === 0 ? 'Calibrate' : 'Recalibrate'}
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
