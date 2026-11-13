import { useCallback, useMemo, useRef, useState } from 'react';
import { defaultBoardName, validatePatientData } from '../../../domain';
import type { FieldErrors, PatientData } from '../../../domain';

export interface PatientFormState {
  data: PatientData;
  allErrors: FieldErrors;
  saving: boolean;
  submitError: string | null;
  update: (patch: Partial<PatientData>) => void;
  save: () => void;
}

/** Holds the form data, the validation errors and the save state for a patient form. */
export function usePatientForm(initial: PatientData, onSubmit: (data: PatientData) => Promise<void>): PatientFormState {
  const [data, setData] = useState<PatientData>(initial);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // board name follows the name until someone edits it
  const boardNameEdited = useRef(initial.boardName !== '' && initial.boardName !== defaultBoardName(initial.firstName, initial.lastName));

  const update = useCallback((patch: Partial<PatientData>) => {
    if ('boardName' in patch) boardNameEdited.current = patch.boardName !== '';
    setData((current) => {
      const next = { ...current, ...patch };
      if (!boardNameEdited.current && !('boardName' in patch) && ('firstName' in patch || 'lastName' in patch)) {
        next.boardName = defaultBoardName(next.firstName, next.lastName);
      }
      return next;
    });
  }, []);

  const allErrors = useMemo(() => validatePatientData(data), [data]);

  const save = useCallback(() => {
    setSaving(true);
    setSubmitError(null);
    onSubmit(data)
      .catch((e: unknown) => setSubmitError(e instanceof Error ? e.message : 'Could not save'))
      .finally(() => setSaving(false));
  }, [data, onSubmit]);

  return { data, allErrors, saving, submitError, update, save };
}
