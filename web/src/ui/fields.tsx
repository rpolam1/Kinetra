import { useId } from 'react';
import type { ReactNode } from 'react';

interface FieldFrameProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

/** The label, hint and error message around a form control. The error replaces the hint. */
export function FieldFrame({ id, label, error, hint, required, children }: FieldFrameProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-slate-700">
        {label}
        {required ? <span aria-hidden="true" className="text-red-700"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}

const INPUT =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-card transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-500 focus:outline-2 focus:outline-offset-0 focus:outline-teal-500/25 disabled:bg-slate-100 disabled:text-slate-500';

/** The classes for a text control, with a red border when there is an error. */
export function inputClass(error?: string): string {
  return `${INPUT} ${error ? 'border-red-500' : 'border-slate-300'}`;
}

interface CommonProps {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}

interface TextFieldProps extends CommonProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'date' | 'password';
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  max?: string;
}

/** A single line input. The name becomes a data-field attribute that identifies the control. */
export function TextField({ label, name, error, hint, required, disabled, value, onChange, type = 'text', placeholder, autoComplete, maxLength, max }: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint} required={required}>
      <input
        id={id}
        data-field={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}

interface NumberFieldProps extends CommonProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

/** A number input. An empty box gives null instead of zero. */
export function NumberField({ label, name, error, hint, required, disabled, value, onChange, min, max, step, placeholder }: NumberFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint} required={required}>
      <input
        id={id}
        data-field={name}
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}

interface TextAreaFieldProps extends CommonProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

/** A multi line text input. */
export function TextAreaField({ label, name, error, hint, required, disabled, value, onChange, rows = 3, placeholder }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint} required={required}>
      <textarea
        id={id}
        data-field={name}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(error)}
      />
    </FieldFrame>
  );
}

interface SelectFieldProps<T extends string> extends CommonProps {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}

/** A drop down list. */
export function SelectField<T extends string>({ label, name, error, hint, required, disabled, value, onChange, options }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint} required={required}>
      <select
        id={id}
        data-field={name}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value as T)}
        className={inputClass(error)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldFrame>
  );
}

interface CheckboxFieldProps {
  label: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

/** A checkbox with a label and an optional hint. */
export function CheckboxField({ label, name, checked, onChange, hint, disabled }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} data-field={name} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-400 accent-teal-600" />
      <label htmlFor={id} className="text-sm text-slate-800">
        {label}
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </label>
    </div>
  );
}
