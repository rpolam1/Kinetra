import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useCurrentPath } from './router';
import { SlidingNav } from './SlidingNav';
import type { NavItem } from './SlidingNav';
import { useAutoTagSync } from './hooks/useTagSync';
import { useAccounts } from './providers/AccountsProvider';
import { useAuth } from './providers/AuthProvider';
import { useHub } from './providers/HubProvider';
import type { HubStatus } from './providers/HubProvider';
import { ROLE_INFO } from '../domain';
import { Avatar } from '../ui/display';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { useRise } from '../ui/motion/useRise';

const HUB_LABEL: Record<HubStatus, { text: string; dot: string }> = {
  checking: { text: 'Hub: checking…', dot: 'bg-ink-300' },
  online: { text: 'Hub connected', dot: 'bg-emerald-400' },
  offline: { text: 'Hub offline', dot: 'bg-red-400' },
  unauthorized: { text: 'Hub needs a key', dot: 'bg-amber-400' },
};

/** The page frame with the side navigation, hub status and account links. On small screens the navigation becomes a strip across the top. */
export function AppShell({ children }: { children: ReactNode }) {
  useAutoTagSync();
  const { user, signOut, demo, can } = useAuth();
  const { status } = useHub();
  const { awaitingCount } = useAccounts();
  const path = useCurrentPath();
  const main = useRef<HTMLElement>(null);
  useRise(main);
  const hub = HUB_LABEL[status];

  const items: NavItem[] = [
    { to: '/patients', label: 'Patients', icon: 'patients' },
    { to: '/session', label: 'Live session', icon: 'session' },
    { to: '/board', label: 'Board', icon: 'board' },
    // The Team page is only listed for people who can manage users
    ...(can('user:manage') ? [{ to: '/admin/users', label: 'Team', icon: 'team' as const, badge: awaitingCount }] : []),
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];
  const name = user?.displayName || user?.email || '';

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="ink-surface text-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6 lg:pb-5 lg:pt-7">
          <Link to="/patients" aria-label="Kinetra home">
            <Logo height={34} />
          </Link>
          <Link to="/account" className="lg:hidden" aria-label="Your account">
            <Avatar name={name} size={32} />
          </Link>
        </div>
        <div className="overflow-x-auto px-2 pb-2 lg:flex-1 lg:overflow-visible lg:px-3 lg:pb-0">
          <SlidingNav items={items} activePath={path} />
        </div>
        <div className="hidden space-y-3 border-t border-white/10 p-4 lg:block">
          <p data-testid="hub-status" className="flex items-center gap-2 text-xs font-medium text-ink-100">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${hub.dot}`} />
            {hub.text}
          </p>
          <Link to="/account" data-hover="nav" className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/10" aria-label="Your account">
            <Avatar name={name} size={36} tone="bg-teal-300/90 text-teal-950" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-white" data-hover-label>{name}</span>
              <span className="block text-xs text-ink-200">{user?.role ? ROLE_INFO[user.role].label : ''}</span>
            </span>
          </Link>
          <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-100 hover:bg-white/10 hover:text-white">
            <Icon name="signOut" /> Sign out
          </button>
        </div>
      </aside>

      <main ref={main} className="paper min-h-screen">
        {demo ? (
          <p className="flex items-center justify-center gap-2 bg-clay-500 px-4 py-1.5 text-center text-xs font-medium text-white">
            <Icon name="info" /> Demo mode: data stays in this browser only.
          </p>
        ) : null}
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
