import { useCallback } from 'react';
import { emptyPatientData } from '../../domain';
import type { PatientData } from '../../domain';
import { navigate } from '../../app/router';
import { useTagSync } from '../../app/hooks/useTagSync';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { Alert, PageHeader } from '../../ui/display';
import { PatientForm } from './form/PatientForm';

export function NewPatientPage() {
  const { patients } = useData();
  const { user, can } = useAuth();
  const toast = useToast();
  const syncTags = useTagSync();

  const create = useCallback(
    async (data: PatientData) => {
      const patient = await patients.create(data, user?.uid ?? 'unknown');
      await syncTags({ quiet: true }); // best effort, the hub re-syncs on reconnect anyway
      toast.success(`Created ${patient.code}. Tag #${patient.tagId} assigned: print it now.`);
      navigate(`/patients/${patient.id}/tag`);
    },
    [patients, user, syncTags, toast],
  );

  if (!can('patient:create')) {
    return <Alert tone="warning" title="You do not have permission to create patients." />;
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Intake" title="New patient" description="Saving creates the profile and assigns a patient code and an AprilTag so the cameras can recognise them." />
      <PatientForm layout="steps" initial={emptyPatientData()} submitLabel="Create patient" cancelTo="/patients" onSubmit={create} />
    </div>
  );
}
