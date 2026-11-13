import { useState } from 'react';
import type { FormEvent } from 'react';
import { computeAge } from '../../../domain';
import type { FieldErrors, PatientData } from '../../../domain';
import { Link } from '../../../app/router';
import { Button } from '../../../ui/Button';
import { Alert, Card, DefinitionList } from '../../../ui/display';
import { Icon } from '../../../ui/Icon';
import { ProgressBar } from '../../../ui/motion/ProgressBar';
import { STREAM_LABELS } from '../labels';
import { ConsentSection, ContactSection, FitnessSection, HealthSection, IdentitySection, ProgramSection, SafetySection } from './sections';
import type { SectionProps } from './sections';
import { FORM_STEPS, errorsForSteps, firstStepWithErrors, stepOfError } from './steps';
import { usePatientForm } from './usePatientForm';

interface PatientFormProps {
  initial: PatientData;
  submitLabel: string;
  onSubmit: (data: PatientData) => Promise<void>;
  cancelTo?: string;
  disabled?: boolean;
  layout?: 'steps' | 'single';
}

// The focus waits a moment so the error messages have been drawn before the first one is found
const focusFirstInvalid = () => setTimeout(() => document.querySelector<HTMLElement>('[data-field][aria-invalid="true"]')?.focus(), 30);

/** The patient form. The steps layout is for new patients and shows one step at a time, and the single layout shows every section on one page for editing. */
export function PatientForm({ initial, submitLabel, onSubmit, cancelTo, disabled, layout = 'single' }: PatientFormProps) {
  const form = usePatientForm(initial, onSubmit);
  const { data, allErrors, saving, submitError, update, save } = form;
  const steps = layout === 'steps';
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  // a step's errors show once you try to leave it
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const shown: FieldErrors = steps ? errorsForSteps(allErrors, revealed) : submitted ? allErrors : {};
  const errorCount = Object.keys(steps ? errorsForSteps(shown, new Set([step])) : shown).length;
  const section: SectionProps = { data, errors: shown, update, disabled: disabled || saving };
  const last = FORM_STEPS.length - 1;

  const goTo = (index: number) => {
    setStep(index);
    setFurthest((f) => Math.max(f, index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    setRevealed((r) => new Set(r).add(step));
    const here = Object.keys(allErrors).filter((key) => stepOfError(key) === step);
    if (here.length > 0) {
      focusFirstInvalid();
      return;
    }
    goTo(step + 1);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (steps && step < last) {
      next();
      return;
    }
    if (steps) setRevealed(new Set(FORM_STEPS.keys()));
    setSubmitted(true);
    const bad = firstStepWithErrors(allErrors);
    if (bad !== null) {
      if (steps && bad !== step) goTo(bad);
      focusFirstInvalid();
      return;
    }
    save();
  };

  const cancel = cancelTo ? (
    <Link to={cancelTo} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-900/[0.06]">
      Cancel
    </Link>
  ) : null;

  if (!steps) {
    return (
      <form onSubmit={submit} noValidate className="space-y-6" aria-label="Patient details">
        {errorCount > 0 ? <Alert tone="error" title={`Please fix ${errorCount} field${errorCount === 1 ? '' : 's'} below`} /> : null}
        <IdentitySection {...section} />
        <ContactSection {...section} />
        <ProgramSection {...section} />
        <SafetySection {...section} />
        <HealthSection {...section} />
        <FitnessSection {...section} />
        <ConsentSection {...section} />
        {submitError ? <Alert tone="error" title="Could not save">{submitError}</Alert> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving} disabled={disabled} icon="save">{submitLabel}</Button>
          {cancel}
        </div>
      </form>
    );
  }

  const current = FORM_STEPS[step]!;
  const age = computeAge(data.dateOfBirth);

  return (
    <form onSubmit={submit} noValidate aria-label="Patient details" className="space-y-5 pb-24">
      <nav aria-label="Form steps" data-rise className="rounded-(--radius-card) border border-slate-200 bg-white px-4 pb-3 pt-4 shadow-card">
        <ol className="grid grid-cols-5 gap-2">
          {FORM_STEPS.map((s, i) => {
            const done = i < step || (i <= furthest && i !== step && !Object.keys(allErrors).some((k) => stepOfError(k) === i));
            const active = i === step;
            const reachable = i <= furthest;
            const problem = revealed.has(i) && i !== step && Object.keys(allErrors).some((k) => stepOfError(k) === i);
            return (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  disabled={!reachable || saving}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => goTo(i)}
                  data-hover="nav"
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${active ? 'bg-teal-50' : reachable ? 'hover:bg-slate-100' : ''} disabled:cursor-default`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors ${
                      problem ? 'bg-red-100 text-red-700' : active ? 'bg-teal-600 text-white' : done ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {problem ? <Icon name="warning" /> : done && !active ? <Icon name="check" /> : <Icon name={s.icon} />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[11px] font-semibold uppercase tracking-wider ${active ? 'text-teal-700' : 'text-slate-400'}`}>Step {i + 1}</span>
                    <span className={`hidden truncate text-sm font-medium sm:block ${active ? 'text-slate-900' : 'text-slate-600'}`}>{s.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <ProgressBar value={(step + 1) / FORM_STEPS.length} label="Form progress" className="mt-3" heightClassName="h-1" trackClassName="bg-slate-100" barClassName="bg-teal-500" />
      </nav>

      {errorCount > 0 ? <Alert tone="error" title={`Please fix ${errorCount} field${errorCount === 1 ? '' : 's'} below`} /> : null}

      <div key={current.id} className="space-y-5">
        {current.id === 'about' ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <IdentitySection {...section} />
            <ContactSection {...section} />
          </div>
        ) : null}
        {current.id === 'program' ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <ProgramSection {...section} />
            <SafetySection {...section} />
          </div>
        ) : null}
        {current.id === 'health' ? <HealthSection {...section} /> : null}
        {current.id === 'fitness' ? <FitnessSection {...section} /> : null}
        {current.id === 'consent' ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <ConsentSection {...section} />
            <Card title="Review" description="What will be created when you save.">
              <DefinitionList
                items={[
                  { term: 'Name', detail: `${data.firstName} ${data.lastName}`.trim() || 'Not entered' },
                  { term: 'Age', detail: age !== null ? String(age) : 'Not entered' },
                  { term: 'Shown on the board as', detail: data.boardName || 'Not entered' },
                  { term: 'Program', detail: STREAM_LABELS[data.stream] },
                  { term: 'Consent', detail: data.consent.exercise && data.consent.cameraTracking ? 'Exercise and camera tracking' : data.consent.exercise || data.consent.cameraTracking ? 'Partly given' : 'Not recorded yet' },
                ]}
              />
              <p className="mt-3 text-sm text-slate-600">A patient code and an AprilTag are assigned automatically, and you can print the tag right after.</p>
            </Card>
          </div>
        ) : null}
      </div>

      {submitError ? <Alert tone="error" title="Could not save">{submitError}</Alert> : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-slate-50/90 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button variant="secondary" icon="back" onClick={() => goTo(step - 1)} disabled={saving}>Back</Button>
            ) : (
              cancel
            )}
          </div>
          <span className="hidden text-sm text-slate-500 sm:block">
            {current.title} <span className="text-slate-400">· {step + 1} of {FORM_STEPS.length}</span>
          </span>
          {step < last ? (
            <Button type="submit" iconAfter="next">Next</Button>
          ) : (
            <Button type="submit" loading={saving} disabled={disabled} icon="save">{submitLabel}</Button>
          )}
        </div>
      </div>
    </form>
  );
}
