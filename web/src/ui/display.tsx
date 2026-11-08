import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icons';

export type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const BADGE: Record<Tone, string> = {
  slate: 'bg-slate-200/80 text-slate-700',
  green: 'bg-emerald-100 text-emerald-900',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
  blue: 'bg-sky-100 text-sky-900',
  violet: 'bg-indigo-100 text-indigo-900',
};

export function Badge({ tone = 'slate', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${BADGE[tone]}`}>
      {icon ? <Icon name={icon} className="text-[0.9em]" /> : null}
      {children}
    </span>
  );
}

type AlertTone = 'info' | 'warning' | 'error' | 'success';

const ALERT: Record<AlertTone, { box: string; icon: IconName; iconColor: string }> = {
  info: { box: 'border-sky-200 bg-sky-50 text-sky-950', icon: 'info', iconColor: 'text-sky-600' },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-950', icon: 'warning', iconColor: 'text-amber-600' },
  error: { box: 'border-red-300 bg-red-50 text-red-950', icon: 'error', iconColor: 'text-red-600' },
  success: { box: 'border-emerald-300 bg-emerald-50 text-emerald-950', icon: 'success', iconColor: 'text-emerald-600' },
};

export function Alert({ tone = 'info', title, children }: { tone?: AlertTone; title?: string; children?: ReactNode }) {
  const look = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${look.box}`}>
      <Icon name={look.icon} className={`mt-0.5 text-base ${look.iconColor}`} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  flush?: boolean;
}

export function Card({ title, description, actions, children, className = '', flush = false }: CardProps) {
  return (
    <section data-rise className={`rounded-(--radius-card) border border-slate-200 bg-white shadow-card ${className}`}>
      {title || actions ? (
        <header className={`flex items-start justify-between gap-3 px-5 pt-4 ${flush ? 'pb-3' : 'pb-1'}`}>
          <div>
            {title ? <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={flush ? '' : `px-5 pb-5 ${title || actions ? 'pt-3' : 'pt-5'}`}>{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header data-rise className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5 text-teal-700">{eyebrow}</p> : null}
        <h1 className="text-[1.75rem] font-semibold leading-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Icon name="spinner" spin />
      {label}
    </p>
  );
}

export function EmptyState({ title, icon = 'info', children }: { title: string; icon?: IconName; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-slate-200/70 text-slate-500">
        <Icon name={icon} />
      </span>
      <p className="font-medium text-slate-800">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</div> : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: readonly { term: string; detail: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term}>
          <dt className="eyebrow text-slate-500">{item.term}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function Avatar({ name, size = 32, tone = 'bg-teal-100 text-teal-900' }: { name: string; size?: number; tone?: string }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }} className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${tone}`}>
      {initialsOf(name)}
    </span>
  );
}
