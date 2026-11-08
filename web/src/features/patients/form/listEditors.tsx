import type { BaselineTest, FieldErrors, Medication } from '../../../domain';
import { todayIso } from '../../../domain';
import { Button } from '../../../ui/Button';
import { DatePicker } from '../../../ui/DatePicker';
import { CheckboxField, TextField } from '../../../ui/fields';

interface ListProps<T> {
  items: readonly T[];
  errors: FieldErrors;
  onChange: (items: T[]) => void;
}

export function StringListEditor({ items, errors, onChange, label, name, placeholder }: ListProps<string> & { label: string; name: string; placeholder?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <TextField label={`${label} ${i + 1}`} name={`${name}.${i}`} value={item} placeholder={placeholder} error={errors[`${name}.${i}`]} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} />
          </div>
          <Button variant="ghost" size="sm" className="mt-6" icon="remove" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={() => onChange([...items, ''])}>
        Add {label.toLowerCase()}
      </Button>
    </fieldset>
  );
}

export function MedicationEditor({ items, errors, onChange }: ListProps<Medication>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">Medications</legend>
      {items.map((m, i) => (
        <div key={i} className="flex flex-wrap items-start gap-3">
          <div className="min-w-48 flex-1">
            <TextField label={`Medication ${i + 1}`} name={`medications.${i}.name`} value={m.name} error={errors[`medications.${i}.name`]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
          </div>
          <div className="mt-7">
            <CheckboxField label="Beta-blocker" name={`medications.${i}.betaBlocker`} checked={m.betaBlocker} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, betaBlocker: v } : x)))} />
          </div>
          <Button variant="ghost" size="sm" className="mt-6" icon="remove" aria-label={`Remove medication ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={() => onChange([...items, { name: '', betaBlocker: false }])}>
        Add medication
      </Button>
    </fieldset>
  );
}

export function BaselineTestEditor({ items, errors, onChange }: ListProps<BaselineTest>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">Baseline test results</legend>
      {items.map((t, i) => (
        <div key={i} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
          <TextField label={`Test ${i + 1}`} name={`baselineTests.${i}.name`} value={t.name} placeholder="e.g. 30-second chair stand" error={errors[`baselineTests.${i}.name`]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
          <TextField label="Result" name={`baselineTests.${i}.result`} value={t.result} error={errors[`baselineTests.${i}.result`]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, result: v } : x)))} />
          <DatePicker label="Date" name={`baselineTests.${i}.date`} max={todayIso()} value={t.date} error={errors[`baselineTests.${i}.date`]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, date: v } : x)))} />
          <Button variant="ghost" size="sm" className="mt-6" icon="remove" aria-label={`Remove test ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={() => onChange([...items, { name: '', result: '', date: todayIso() }])}>
        Add test result
      </Button>
    </fieldset>
  );
}
