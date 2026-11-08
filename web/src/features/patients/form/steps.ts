import type { FieldErrors } from '../../../domain';
import type { IconName } from '../../../ui/icons';

export interface FormStep {
  id: 'about' | 'program' | 'health' | 'fitness' | 'consent';
  label: string;
  title: string;
  icon: IconName;
  fields: readonly string[];
}

export const FORM_STEPS: readonly FormStep[] = [
  { id: 'about', label: 'About', title: 'About them', icon: 'user', fields: ['firstName', 'lastName', 'dateOfBirth', 'boardName', 'phone', 'email', 'emergencyContact'] },
  { id: 'program', label: 'Program', title: 'Program and safety', icon: 'checklist', fields: ['stream', 'referralSource', 'referralNotes', 'mobilityAid', 'fallsRisk', 'supervision', 'affectedSide'] },
  { id: 'health', label: 'Health', title: 'Health background', icon: 'heart', fields: ['diagnoses', 'medications', 'precautions'] },
  { id: 'fitness', label: 'Fitness', title: 'Fitness and goals', icon: 'running', fields: ['restingHr', 'maxHr', 'baselineTests', 'goals'] },
  { id: 'consent', label: 'Consent', title: 'Consent and review', icon: 'lock', fields: ['consent'] },
];

export function stepOfError(key: string): number {
  const index = FORM_STEPS.findIndex((s) => s.fields.some((f) => key === f || key.startsWith(`${f}.`)));
  return index === -1 ? 0 : index;
}

export function errorsForSteps(errors: FieldErrors, steps: ReadonlySet<number>): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => steps.has(stepOfError(key))));
}

export function firstStepWithErrors(errors: FieldErrors): number | null {
  const steps = Object.keys(errors).map(stepOfError);
  return steps.length === 0 ? null : Math.min(...steps);
}
