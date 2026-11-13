import { useCallback } from 'react';
import { toPatientData } from '../../../domain';
import type { Patient, PatientData } from '../../../domain';
import { navigate } from '../../../app/router';
import { useTagSync } from '../../../app/hooks/useTagSync';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useData } from '../../../app/providers/DataProvider';
import { useToast } from '../../../app/providers/ToastProvider';
import { Button } from '../../../ui/Button';
import { Alert, Card } from '../../../ui/display';
import { PatientForm } from '../form/PatientForm';

/** Edits the patient record and holds the archive action. Editing is locked for archived patients and for roles without permission. */
export function DetailsTab({ patient, onChanged }: { patient: Patient; onChanged: () => void }) {
  const { patients } = useData();
  const { user, can } = useAuth();
  const toast = useToast();
  const syncTags = useTagSync();
  const editable = can('patient:edit') && patient.status === 'active';

  // Wrapped in useCallback so the form does not see a new submit handler on every render
  const save = useCallback(
    async (data: PatientData) => {
      await patients.update(patient.id, data, user?.uid ?? 'unknown');
      await syncTags({ quiet: true }); // board name travels with the tag
      toast.success('Details saved.');
      onChanged();
    },
    [patients, patient.id, user, syncTags, toast, onChanged],
  );

  // Archiving frees the tag, so the hub list is refreshed right after
  const archive = useCallback(async () => {
    const ok = window.confirm(`Archive ${patient.firstName} ${patient.lastName}? Their tag will be freed. Their records are kept.`);
    if (!ok) return;
    try {
      await patients.archive(patient.id, user?.uid ?? 'unknown');
      await syncTags({ quiet: true });
      toast.success('Patient archived.');
      navigate('/patients');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not archive');
    }
  }, [patients, patient, user, syncTags, toast]);

  return (
    <div className="space-y-6">
      {!editable ? (
        <Alert tone="info">{patient.status === 'archived' ? 'This patient is archived and read-only.' : 'You have read-only access.'}</Alert>
      ) : null}
      <PatientForm key={patient.updatedAt} initial={toPatientData(patient)} submitLabel="Save changes" onSubmit={save} disabled={!editable} />
      {can('patient:archive') && patient.status === 'active' ? (
        <Card title="Archive patient" description="Frees their AprilTag for someone else. Nothing is deleted.">
          <Button variant="danger" icon="blocked" onClick={archive}>Archive this patient</Button>
        </Card>
      ) : null}
    </div>
  );
}
