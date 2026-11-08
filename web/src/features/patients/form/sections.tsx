import { DOSE_GUIDELINES, computeAge, estimateMaxHr, hasBetaBlocker, heartRateZone, todayIso } from '../../../domain';
import type { FieldErrors, PatientData } from '../../../domain';
import { Alert, Card } from '../../../ui/display';
import { DatePicker } from '../../../ui/DatePicker';
import { CheckboxField, NumberField, SelectField, TextAreaField, TextField } from '../../../ui/fields';
import { AID_LABELS, FALLS_LABELS, REFERRAL_LABELS, SIDE_LABELS, STREAM_LABELS, SUPERVISION_LABELS, toOptions } from '../labels';
import { BaselineTestEditor, MedicationEditor, StringListEditor } from './listEditors';

export interface SectionProps {
  data: PatientData;
  errors: FieldErrors;
  update: (patch: Partial<PatientData>) => void;
  disabled?: boolean;
}

const grid = 'grid gap-4 sm:grid-cols-2';

export function IdentitySection({ data, errors, update, disabled }: SectionProps) {
  const age = computeAge(data.dateOfBirth);
  return (
    <Card title="Who they are">
      <div className={grid}>
        <TextField label="First name" name="firstName" required value={data.firstName} error={errors.firstName} disabled={disabled} autoComplete="off" onChange={(v) => update({ firstName: v })} />
        <TextField label="Last name" name="lastName" required value={data.lastName} error={errors.lastName} disabled={disabled} autoComplete="off" onChange={(v) => update({ lastName: v })} />
        <DatePicker label="Date of birth" name="dateOfBirth" required max={todayIso()} value={data.dateOfBirth} error={errors.dateOfBirth} disabled={disabled} startView="years" anchorYear={1950} hint={age !== null ? `Age ${age}` : 'Type it, or open the calendar and pick the year first.'} onChange={(v) => update({ dateOfBirth: v })} />
        <TextField label="Name shown on the public board" name="boardName" required value={data.boardName} error={errors.boardName} disabled={disabled} maxLength={24} hint="First name and last initial by default. The board never shows medical information." onChange={(v) => update({ boardName: v })} />
      </div>
    </Card>
  );
}

export function ContactSection({ data, errors, update, disabled }: SectionProps) {
  const ec = data.emergencyContact;
  const setEc = (patch: Partial<typeof ec>) => update({ emergencyContact: { ...ec, ...patch } });
  return (
    <Card title="Contact and emergency contact" description="Optional, but an emergency contact is strongly recommended.">
      <div className={grid}>
        <TextField label="Phone" name="phone" type="tel" value={data.phone} error={errors.phone} disabled={disabled} autoComplete="off" onChange={(v) => update({ phone: v })} />
        <TextField label="Email" name="email" type="email" value={data.email} error={errors.email} disabled={disabled} autoComplete="off" onChange={(v) => update({ email: v })} />
        <TextField label="Emergency contact name" name="emergencyContact.name" value={ec.name} error={errors['emergencyContact.name']} disabled={disabled} onChange={(v) => setEc({ name: v })} />
        <TextField label="Emergency contact phone" name="emergencyContact.phone" type="tel" value={ec.phone} error={errors['emergencyContact.phone']} disabled={disabled} onChange={(v) => setEc({ phone: v })} />
        <TextField label="Relationship" name="emergencyContact.relationship" value={ec.relationship} disabled={disabled} onChange={(v) => setEc({ relationship: v })} />
      </div>
    </Card>
  );
}

export function ProgramSection({ data, errors, update, disabled }: SectionProps) {
  return (
    <Card title="Program and referral">
      <div className={grid}>
        <SelectField label="Program" name="stream" value={data.stream} options={toOptions(STREAM_LABELS)} disabled={disabled} onChange={(v) => update({ stream: v })} />
        <SelectField label="Referred by" name="referralSource" value={data.referralSource} options={toOptions(REFERRAL_LABELS)} disabled={disabled} onChange={(v) => update({ referralSource: v })} />
      </div>
      <div className="mt-4">
        <TextAreaField label="Referral notes" name="referralNotes" value={data.referralNotes} error={errors.referralNotes} disabled={disabled} rows={2} onChange={(v) => update({ referralNotes: v })} />
      </div>
    </Card>
  );
}

export function HealthSection({ data, errors, update, disabled }: SectionProps) {
  return (
    <Card title="Health background" description="Only what the exercise program needs. Used for safety warnings and dosing.">
      <div className="space-y-5">
        <StringListEditor label="Diagnosis" name="diagnoses" items={data.diagnoses} errors={errors} placeholder="e.g. Ischemic stroke (2025)" onChange={(diagnoses) => update({ diagnoses })} />
        <MedicationEditor items={data.medications} errors={errors} onChange={(medications) => update({ medications })} />
        <TextAreaField label="Precautions and contraindications" name="precautions" value={data.precautions} error={errors.precautions} disabled={disabled} hint="e.g. no overhead lifting, avoid deep knee flexion, monitor blood pressure" onChange={(v) => update({ precautions: v })} />
      </div>
    </Card>
  );
}

export function SafetySection({ data, update, disabled }: SectionProps) {
  return (
    <Card title="Mobility and supervision" description="Tells instructors and volunteers how to look after them in the room.">
      <div className={grid}>
        <SelectField label="Mobility aid" name="mobilityAid" value={data.mobilityAid} options={toOptions(AID_LABELS)} disabled={disabled} onChange={(v) => update({ mobilityAid: v })} />
        <SelectField label="Falls risk" name="fallsRisk" value={data.fallsRisk} options={toOptions(FALLS_LABELS)} disabled={disabled} onChange={(v) => update({ fallsRisk: v })} />
        <SelectField label="Supervision needed" name="supervision" value={data.supervision} options={toOptions(SUPERVISION_LABELS)} disabled={disabled} hint="Tells instructors who a volunteer should sit with." onChange={(v) => update({ supervision: v })} />
        <SelectField label="Affected side (stroke)" name="affectedSide" value={data.affectedSide} options={toOptions(SIDE_LABELS)} disabled={disabled} onChange={(v) => update({ affectedSide: v })} />
      </div>
    </Card>
  );
}

export function FitnessSection({ data, errors, update, disabled }: SectionProps) {
  const age = computeAge(data.dateOfBirth);
  const zone = heartRateZone({ age, restingHr: data.restingHr, maxHr: data.maxHr, lowPct: DOSE_GUIDELINES.cardioIntensityPct.low, highPct: DOSE_GUIDELINES.cardioIntensityPct.high });
  return (
    <Card title="Fitness baseline and goals" description="From the graded exercise test and the intake assessment.">
      <div className="space-y-5">
        <div className={grid}>
          <NumberField label="Resting heart rate (bpm)" name="restingHr" min={30} max={130} value={data.restingHr} error={errors.restingHr} disabled={disabled} onChange={(v) => update({ restingHr: v })} />
          <NumberField label="Maximum heart rate (bpm)" name="maxHr" min={90} max={220} value={data.maxHr} error={errors.maxHr} disabled={disabled} hint={age !== null ? `Leave empty to estimate (about ${estimateMaxHr(age)} bpm). Use the measured value from the graded test when you have it.` : 'Enter a date of birth to get an estimate.'} onChange={(v) => update({ maxHr: v })} />
        </div>
        {hasBetaBlocker(data) ? (
          <Alert tone="warning" title="Beta-blocker">
            Heart-rate targets are not reliable on beta-blockers. Prescribe cardio by perceived exertion instead.
          </Alert>
        ) : zone ? (
          <Alert tone="info" title="Cardio target (40-60% of heart-rate reserve)">
            {zone.lowBpm}-{zone.highBpm} bpm, from a {zone.maxHrSource} maximum of {zone.maxHr} bpm.
          </Alert>
        ) : null}
        <BaselineTestEditor items={data.baselineTests} errors={errors} onChange={(baselineTests) => update({ baselineTests })} />
        <TextAreaField label="Goals" name="goals" value={data.goals} error={errors.goals} disabled={disabled} hint="In the participant's own words where possible." onChange={(v) => update({ goals: v })} />
      </div>
    </Card>
  );
}

export function ConsentSection({ data, errors, update, disabled }: SectionProps) {
  const c = data.consent;
  // ticking a box sets the consent date to today, still editable
  const set = (patch: Partial<typeof c>) => {
    const next = { ...c, ...patch };
    if ((next.exercise || next.cameraTracking) && next.signedOn === '') next.signedOn = todayIso();
    update({ consent: next });
  };
  return (
    <Card title="Consent" description="Movement tracking uses skeleton points only. No video or images are stored.">
      <div className="space-y-3">
        <CheckboxField label="Consents to take part in the exercise program" name="consent.exercise" checked={c.exercise} disabled={disabled} onChange={(v) => set({ exercise: v })} />
        <CheckboxField label="Consents to camera-based movement tracking" name="consent.cameraTracking" checked={c.cameraTracking} disabled={disabled} hint="Required before calibration and live tracking." onChange={(v) => set({ cameraTracking: v })} />
        {c.exercise || c.cameraTracking ? (
          <div className="max-w-xs">
            <DatePicker label="Date consent was signed" name="consent.signedOn" max={todayIso()} value={c.signedOn} error={errors['consent.signedOn']} disabled={disabled} onChange={(v) => set({ signedOn: v })} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
