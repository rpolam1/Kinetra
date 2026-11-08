import { useEffect, useRef } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { ROLE_INFO } from '../../domain';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Logo } from '../../ui/Logo';
import { gsap, motionAllowed } from '../../ui/motion/gsap';

interface Look {
  icon: IconName;
  title: string;
  ring: string;
}

const LOOK = {
  pending: { icon: 'hourglass', title: 'Your request is with an administrator', ring: 'text-amber-400' },
  rejected: { icon: 'blocked', title: 'This request was declined', ring: 'text-red-400' },
  disabled: { icon: 'disabledUser', title: 'Your access has been switched off', ring: 'text-slate-400' },
  approved: { icon: 'check', title: 'You are approved', ring: 'text-emerald-400' },
} as const satisfies Record<string, Look>;

export function AccountStatusScreen() {
  const { user, signOut } = useAuth();
  const ring = useRef<HTMLSpanElement>(null);
  const status = user?.status ?? 'pending';
  const look = LOOK[status];

  useEffect(() => {
    const el = ring.current;
    if (!el || status !== 'pending' || !motionAllowed()) return undefined;
    const tween = gsap.to(el, { scale: 1.6, autoAlpha: 0, duration: 1.8, ease: 'power1.out', repeat: -1 });
    return () => {
      tween.kill();
    };
  }, [status]);

  if (!user) return null;
  const wanted = user.requestedRole ? ROLE_INFO[user.requestedRole].label.toLowerCase() : null;

  return (
    <div className="ink-surface grid min-h-screen place-items-center px-5 py-10 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mb-10 flex justify-center">
          <Logo height={40} />
        </div>
        <div className="relative mx-auto mb-6 grid h-20 w-20 place-items-center">
          {status === 'pending' ? <span ref={ring} aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-amber-400/70" /> : null}
          <span className={`grid h-20 w-20 place-items-center rounded-full bg-white/10 text-3xl ${look.ring}`}>
            <Icon name={look.icon} />
          </span>
        </div>
        <h1 className="text-2xl font-semibold" data-testid="account-status">{look.title}</h1>
        {status === 'pending' ? (
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-100">
            Thanks, {user.displayName.split(' ')[0] || 'there'}. Your request to join{wanted ? ` as ${wanted}` : ''} was sent. This page opens the app by itself once an administrator approves it.
          </p>
        ) : null}
        {status === 'rejected' ? <p className="mx-auto mt-3 max-w-sm text-[15px] text-ink-100">Contact an administrator if you think this is a mistake.</p> : null}
        {status === 'disabled' ? <p className="mx-auto mt-3 max-w-sm text-[15px] text-ink-100">Contact an administrator to have it switched back on.</p> : null}
        <p className="mt-6 text-sm text-ink-200">Signed in as {user.email}</p>
        <div className="mt-6 flex justify-center">
          <Button variant="dark" icon="signOut" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
