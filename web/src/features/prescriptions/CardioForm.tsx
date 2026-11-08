import { DOSE_GUIDELINES, cardioWarnings, computeAge, hasBetaBlocker, heartRateZone } from '../../domain';
import type { CardioBlock, CardioMachine, Patient } from '../../domain';
import { Alert, Card } from '../../ui/display';
import { NumberField, SelectField, TextField } from '../../ui/fields';
import { Icon } from '../../ui/Icon';

const MACHINES: { value: CardioMachine; label: string }[] = [
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'recumbent_bike', label: 'Recumbent bike' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'other', label: 'Other' },
];

interface CardioFormProps {
  cardio: CardioBlock;
  patient: Pick<Patient, 'dateOfBirth' | 'restingHr' | 'maxHr' | 'medications'>;
  disabled: boolean;
  onChange: (patch: Partial<CardioBlock>) => void;
}

export function CardioForm({ cardio, patient, disabled, onChange }: CardioFormProps) {
  const zone = heartRateZone({
    age: computeAge(patient.dateOfBirth),
    restingHr: patient.restingHr,
    maxHr: patient.maxHr,
    lowPct: cardio.intensityLowPct,
    highPct: cardio.intensityHighPct,
  });
  const warnings = cardioWarnings(cardio);

  return (
    <Card title="Cardio" description={`Every session: a ${DOSE_GUIDELINES.warmupMin.min}-${DOSE_GUIDELINES.warmupMin.max} min warm-up, ${DOSE_GUIDELINES.cardioMainMin.min}-${DOSE_GUIDELINES.cardioMainMin.max} min moderate cardio, then a cool-down.`}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Machine" name="cardio.machine" value={cardio.machine} options={MACHINES} disabled={disabled} onChange={(v) => onChange({ machine: v })} />
          <NumberField label="Warm-up (min)" name="cardio.warmupMin" min={0} max={30} value={cardio.warmupMin} disabled={disabled} onChange={(v) => onChange({ warmupMin: v ?? 0 })} />
          <NumberField label="Main cardio (min)" name="cardio.mainMin" min={0} max={90} value={cardio.mainMin} disabled={disabled} onChange={(v) => onChange({ mainMin: v ?? 0 })} />
          <NumberField label="Cool-down (min)" name="cardio.cooldownMin" min={0} max={30} value={cardio.cooldownMin} disabled={disabled} onChange={(v) => onChange({ cooldownMin: v ?? 0 })} />
          <NumberField label="Intensity from (% reserve)" name="cardio.intensityLowPct" min={10} max={100} value={cardio.intensityLowPct} disabled={disabled} onChange={(v) => onChange({ intensityLowPct: v ?? 0 })} />
          <NumberField label="Intensity to (% reserve)" name="cardio.intensityHighPct" min={10} max={100} value={cardio.intensityHighPct} disabled={disabled} onChange={(v) => onChange({ intensityHighPct: v ?? 0 })} />
        </div>
        <TextField label="Cardio notes" name="cardio.notes" value={cardio.notes} disabled={disabled} onChange={(v) => onChange({ notes: v })} />
        {hasBetaBlocker(patient) ? (
          <Alert tone="warning" title="Beta-blocker">Heart-rate targets are not reliable for this patient. Prescribe by perceived exertion.</Alert>
        ) : zone ? (
          <Alert tone="info" title="Target heart rate">{zone.lowBpm}-{zone.highBpm} bpm ({zone.maxHrSource} maximum {zone.maxHr} bpm)</Alert>
        ) : (
          <p className="text-sm text-slate-600">Add a resting heart rate in Details to see a target heart rate.</p>
        )}
        {warnings.map((w) => (
          <p key={w} className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><Icon name="warning" className="mr-1.5 text-amber-600" />{w}</p>
        ))}
      </div>
    </Card>
  );
}
