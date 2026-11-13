import { useMemo, useState } from 'react';
import { checkSlots, contentEquals, emptyContent, moveItem, newPrescribedExercise } from '../../domain';
import type { ExerciseDefinition, Patient, PrescribedExercise, Prescription, PrescriptionContent } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert, Card, EmptyState } from '../../ui/display';
import { TextField } from '../../ui/fields';
import { CardioForm } from './CardioForm';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseRow } from './ExerciseRow';
import { SlotChecklist } from './SlotChecklist';
import { VersionHistory } from './VersionHistory';

/** The props for the editor. The save callback takes the reason so it can be stored with the new version. */
interface PrescriptionEditorProps {
  patient: Patient;
  current: Prescription | null;
  history: readonly Prescription[];
  canEdit: boolean;
  onSave: (content: PrescriptionContent, reason: string) => Promise<void>;
}

/** The editable part of a prescription, or an empty one for a patient who has none yet. */
function baselineOf(current: Prescription | null): PrescriptionContent {
  return current ? structuredClone({ exercises: current.exercises, cardio: current.cardio }) : emptyContent();
}

/** Edits a draft of the prescription and saves it as a new version. The draft only becomes a version when the person saves. */
export function PrescriptionEditor({ patient, current, history, canEdit, onSave }: PrescriptionEditorProps) {
  const baseline = useMemo(() => baselineOf(current), [current]);
  const [draft, setDraft] = useState<PrescriptionContent>(() => structuredClone(baseline));
  const [reason, setReason] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dirty is judged by content, so undoing a change turns the save button off again
  const dirty = !contentEquals(draft, baseline);
  const slots = useMemo(() => checkSlots(draft.exercises), [draft.exercises]);
  const existingIds = useMemo(() => new Set(draft.exercises.map((e) => e.exerciseId)), [draft.exercises]);

  const setExercises = (exercises: PrescribedExercise[]) => setDraft((d) => ({ ...d, exercises }));
  const addExercise = (def: ExerciseDefinition) => setExercises([...draft.exercises, newPrescribedExercise(def)]);
  const patchExercise = (index: number, patch: Partial<PrescribedExercise>) =>
    setExercises(draft.exercises.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  // Restoring only fills the draft, so the old version is saved as a new one and history is never rewritten
  const restore = (version: Prescription) => {
    setDraft(structuredClone({ exercises: version.exercises, cardio: version.cardio }));
    setReason(`Restored version ${version.version}`);
  };

  const save = async () => {
    setError(null);
    // The first version needs no reason, but every later change does
    if (current && !reason.trim()) {
      setError('Enter a reason for this change (it is kept in the version history).');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the prescription');
      // Saving stays true on success because the parent replaces this editor with a new key
      setSaving(false);
    }
  };

  const disabled = !canEdit || saving;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card
          title={current ? `Prescription: version ${current.version}` : 'New prescription'}
          actions={canEdit ? <Button onClick={() => setPickerOpen(true)} disabled={disabled} icon="plus">Add exercise</Button> : undefined}
        >
          {pickerOpen ? (
            <div className="mb-4">
              <ExercisePicker existingIds={existingIds} onAdd={addExercise} onClose={() => setPickerOpen(false)} />
            </div>
          ) : null}
          {draft.exercises.length === 0 ? (
            <EmptyState title="No exercises yet">Add exercises from the library. The checklist on the right shows what a full session needs.</EmptyState>
          ) : (
            <ol className="space-y-3" aria-label="Prescribed exercises">
              {draft.exercises.map((item, i) => (
                <ExerciseRow
                  key={item.exerciseId}
                  item={item}
                  index={i}
                  count={draft.exercises.length}
                  patient={patient}
                  disabled={disabled}
                  onChange={(patch) => patchExercise(i, patch)}
                  onRemove={() => setExercises(draft.exercises.filter((_, j) => j !== i))}
                  onMove={(dir) => setExercises(moveItem(draft.exercises, i, i + dir))}
                />
              ))}
            </ol>
          )}
        </Card>

        <CardioForm cardio={draft.cardio} patient={patient} disabled={disabled} onChange={(patch) => setDraft((d) => ({ ...d, cardio: { ...d.cardio, ...patch } }))} />

        {canEdit ? (
          <Card title="Save">
            <div className="space-y-4">
              {current ? (
                <TextField label="Reason for this change" name="reason" required value={reason} disabled={saving} placeholder="e.g. progressed squat to 5 lb" onChange={setReason} />
              ) : null}
              {error ? <Alert tone="error">{error}</Alert> : null}
              <div className="flex items-center gap-3">
                <Button onClick={save} loading={saving} disabled={!dirty} icon="save">
                  {current ? `Save as version ${current.version + 1}` : 'Save prescription'}
                </Button>
                {!dirty ? <span className="text-sm text-slate-500">No unsaved changes</span> : null}
              </div>
            </div>
          </Card>
        ) : (
          <Alert tone="info">You have read-only access to prescriptions.</Alert>
        )}
      </div>

      <div className="space-y-6">
        <SlotChecklist slots={slots} exercises={draft.exercises} />
        <VersionHistory history={history} canRestore={canEdit} onRestore={restore} />
      </div>
    </div>
  );
}
