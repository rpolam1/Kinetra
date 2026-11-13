import { useEffect, useRef, useState } from 'react';
import { Logo } from '../../ui/Logo';
import { gsap, motionAllowed } from '../../ui/motion/gsap';
import { MotionTrace } from './MotionTrace';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';

type Mode = 'signin' | 'signup';

const HEADLINE = 'Know who needs a hand before they ask.';
const PITCH = "Kinetra counts every rep and checks form against each person's own baseline, so you can spend your time with the people who need you.";

/** Open on the sign up form when the address asks for it. */
function initialMode(): Mode {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/signup') ? 'signup' : 'signin';
}

/** The sign in and sign up page. Wide screens also show a panel with the product pitch and an animated trace. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const formRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // The form slides in when the mode changes, but not on the first load
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = formRef.current;
    if (el && motionAllowed()) gsap.fromTo(el, { autoAlpha: 0, x: mode === 'signup' ? 24 : -24 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
  }, [mode]);

  useEffect(() => {
    if (!motionAllowed()) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('[data-hero-line]', { autoAlpha: 0, y: 28, duration: 0.9, ease: 'power3.out', stagger: 0.14, delay: 0.1, clearProps: 'opacity,visibility,transform' });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1.25fr)_minmax(24rem,0.75fr)]">
      <aside className="ink-surface relative hidden min-h-screen flex-col overflow-hidden text-white lg:flex">
        <div className="px-14 pt-12">
          <Logo height={42} />
        </div>
        <div className="mt-[clamp(2rem,9vh,6rem)] px-14">
          <h1 data-hero-line className="max-w-[16ch] text-balance text-[clamp(2.8rem,4.6vw,4.4rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            {HEADLINE}
          </h1>
          <p data-hero-line className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-100">{PITCH}</p>
        </div>
        <div className="relative mt-6 min-h-[14rem] flex-1">
          <MotionTrace />
        </div>
        <p className="px-14 pb-10 pt-2 text-sm text-ink-300">Patient information stays with your clinic.</p>
      </aside>

      <main className="flex flex-col">
        <div className="ink-surface px-6 py-7 text-white lg:hidden">
          <Logo height={34} />
          <p className="mt-5 max-w-sm text-2xl font-semibold leading-tight tracking-tight">{HEADLINE}</p>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-12">
          <div ref={formRef} className="w-full max-w-sm">
            {mode === 'signin' ? <SignInForm onSwitch={() => setMode('signup')} /> : <SignUpForm onSwitch={() => setMode('signin')} />}
          </div>
        </div>
      </main>
    </div>
  );
}
