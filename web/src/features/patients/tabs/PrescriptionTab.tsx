import { useCallback } from 'react';
import type { Patient, PrescriptionContent } from '../../../domain';
import { useAsync } from '../../../app/hooks/useAsync';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useData } from '../../../app/providers/DataProvider';
import { useToast } from '../../../app/providers/ToastProvider';
import { Alert, Spinner } from '../../../ui/display';
import { PrescriptionEditor } from '../../prescriptions/PrescriptionEditor';

/** Loads the current prescription and its history and passes them to the editor. */
export function PrescriptionTab({ patient }: { patient: Patient }) {
  const { prescriptions } = useData();
  const { user, can } = useAuth();
  const toast = useToast();
  // Both are loaded together so the editor never shows a version list that disagrees with the current version
  const state = useAsync(async () => ({ current: await prescriptions.current(patient.id), history: await prescriptions.history(patient.id) }), [prescriptions, patient.id]);

  const save = useCallback(
    async (content: PrescriptionContent, reason: string) => {
      const saved = await prescriptions.save(patient.id, content, reason, user?.uid ?? 'unknown');
      toast.success(`Saved as version ${saved.version}.`);
      state.reload();
    },
    [prescriptions, patient.id, user, toast, state],
  );

  // The editor is keyed by prescription id so its draft resets after a save creates a new version
  if (state.error) return <Alert tone="error" title="Could not load the prescription">{state.error.message}</Alert>;
  if (state.data === null) return <Spinner />;

  return (
    <PrescriptionEditor
      key={state.data.current?.id ?? 'none'}
      patient={patient}
      current={state.data.current}
      history={state.data.history}
      canEdit={can('prescription:edit') && patient.status === 'active'}
      onSave={save}
    />
  );
}
