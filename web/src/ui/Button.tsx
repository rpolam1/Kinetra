import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icons';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-600 text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] hover:bg-teal-500',
  secondary: 'border border-slate-300 bg-white text-slate-800 shadow-card hover:border-slate-400 hover:bg-slate-50',
  danger: 'bg-red-700 text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)] hover:bg-red-600',
  ghost: 'text-slate-700 hover:bg-slate-900/[0.06]',
  dark: 'border border-white/15 bg-white/10 text-white hover:bg-white/20',
};

const SIZES: Record<Size, string> = {
  sm: 'gap-1.5 px-2.5 py-1.5 text-[13px]',
  md: 'gap-2 px-4 py-2 text-sm',
};

/** The classes for a button, so a link can be styled like one. */
export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
  children?: ReactNode;
}

/** A button with variants and sizes. While loading it is disabled and shows a spinner, so it cannot be clicked twice. */
export function Button({ variant = 'primary', size = 'md', loading = false, icon, iconAfter, disabled, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-hover="button" className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Icon name="spinner" spin /> : icon ? <span data-hover-icon className="inline-flex"><Icon name={icon} /></span> : null}
      {loading ? 'Working…' : children}
      {iconAfter && !loading ? <span data-hover-icon className="inline-flex"><Icon name={iconAfter} /></span> : null}
    </button>
  );
}
