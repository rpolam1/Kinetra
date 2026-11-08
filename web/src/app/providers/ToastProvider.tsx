import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { gsap, motionAllowed } from '../../ui/motion/gsap';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

const STYLE: Record<ToastTone, { box: string; icon: IconName; accent: string }> = {
  success: { box: 'border-emerald-500/40', icon: 'success', accent: 'text-emerald-400' },
  error: { box: 'border-red-500/50', icon: 'error', accent: 'text-red-400' },
  info: { box: 'border-white/15', icon: 'info', accent: 'text-sky-300' },
};

function ToastItem({ toast }: { toast: Toast }) {
  const ref = useRef<HTMLDivElement>(null);
  const look = STYLE[toast.tone];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    gsap.fromTo(el, { x: 40, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
  }, []);
  return (
    <div ref={ref} role={toast.tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-ink-800 px-4 py-3 text-sm text-white shadow-lg ${look.box}`}>
      <Icon name={look.icon} className={`mt-0.5 text-base ${look.accent}`} />
      <span>{toast.message}</span>
    </div>
  );
}

export function ToastProvider({ children, durationMs = 6000 }: { children: ReactNode; durationMs?: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = next.current++;
      setToasts((list) => [...list, { id, tone, message }]);
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), durationMs);
    },
    [durationMs],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
