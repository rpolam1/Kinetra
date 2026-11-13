import { doseWarnings, getExercise, suitabilityWarnings } from '../../domain';
import type { PatientData, PrescribedExercise, ProgressionRule } from '../../domain';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/display';
import { NumberField, SelectField, TextField } from '../../ui/fields';
import { TrackingBadge } from './TrackingBadge';
import { Icon } from '../../ui/Icon';

// The rules a rep based exercise can use to decide when to raise the load
const PROGRESSION: { value: ProgressionRule; label: string }[] = [
  { value: 'twenty_reps_two_sessions', label: '20 good reps, 2 sessions in a row' },
  { value: 'manual', label: 'Instructor decides' },
];

/** The props for one prescribed exercise. The index and count decide which move buttons are available. */
interface ExerciseRowProps {
  item: PrescribedExercise;
  index: number;
  count: number;
  patient: Pick<PatientData, 'mobilityAid' | 'fallsRisk' | 'supervision'>;
  disabled: boolean;
  onChange: (patch: Partial<PrescribedExercise>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** The editable dose for one exercise, with warnings for the dose and for how suitable it is for this patient. */
export function ExerciseRow({ item, index, count, patient, disabled, onChange, onRemove, onMove }: ExerciseRowProps) {
  const def = getExercise(item.exerciseId);
  if (!def) {
    return <Alert tone="error" title={`Unknown exercise "${item.exerciseId}"`}>It was removed from the library. Remove this line.</Alert>;
  }
  // Timed holds have no reps, and count only or scored exercises have no fixed time
  const repBased = def.tracking === 'scored' || def.tracking === 'count_only';
  const usesSeconds = def.tracking === 'timed' || def.defaultSeconds !== undefined;
  const warnings = [...doseWarnings(item, def), ...suitabilityWarnings(patient, def)];
  const key = `exercise.${index}`;

  return (
    <li className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-label={def.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{def.name}</h3>
          <TrackingBadge mode={def.tracking} />
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={disabled || index === 0} aria-label={`Move ${def.name} up`} onClick={() => onMove(-1)} icon="up" />
          <Button variant="ghost" size="sm" disabled={disabled || index === count - 1} aria-label={`Move ${def.name} down`} onClick={() => onMove(1)} icon="down" />
          <Button variant="ghost" size="sm" disabled={disabled} aria-label={`Remove ${def.name}`} onClick={onRemove} icon="remove">Remove</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <NumberField label="Sets" name={`${key}.sets`} min={1} max={10} value={item.sets} disabled={disabled} onChange={(v) => onChange({ sets: v ?? 1 })} />
        {repBased ? <NumberField label="Reps per set" name={`${key}.reps`} min={1} max={100} value={item.reps} disabled={disabled} onChange={(v) => onChange({ reps: v })} /> : null}
        {usesSeconds ? <NumberField label="Seconds per set" name={`${key}.seconds`} min={1} max={600} value={item.seconds} disabled={disabled} onChange={(v) => onChange({ seconds: v })} /> : null}
        <TextField label="Load" name={`${key}.load`} value={item.load} disabled={disabled} placeholder="e.g. 5 lb, red band" onChange={(v) => onChange({ load: v })} />
        <TextField label="Modification" name={`${key}.modification`} value={item.modification} disabled={disabled} placeholder="e.g. chair-assisted" onChange={(v) => onChange({ modification: v })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Notes" name={`${key}.notes`} value={item.notes} disabled={disabled} onChange={(v) => onChange({ notes: v })} />
        {repBased ? <SelectField label="Progress the load when" name={`${key}.progression`} value={item.progression} options={PROGRESSION} disabled={disabled} onChange={(v) => onChange({ progression: v })} /> : null}
      </div>
      {def.tracking === 'manual' ? <p className="text-xs text-slate-500">The camera cannot measure this one: the instructor records it.</p> : null}
      {warnings.length > 0 ? (
        <ul className="space-y-1" aria-label={`Warnings for ${def.name}`}>
          {warnings.map((w) => (
            <li key={w} className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><Icon name="warning" className="mr-1.5 text-amber-600" />{w}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
