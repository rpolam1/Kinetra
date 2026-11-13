import { useEffect, useRef } from 'react';
import { gsap, motionAllowed } from '../../ui/motion/gsap';

const PERIOD = 3.6; // seconds per rep
const WINDOW = 12; // seconds of history shown
const STANDING = 172; // standing knee angle, degrees
const TARGET_TOP = 108; // top of the target depth band
const TARGET_BOTTOM = 82;
const NOW_AT = 0.86; // where 'now' sits across the trace
const START = PERIOD * 3.55; // start mid-session so the first frame already has history

/** How deep squat number k goes. Every fifth squat is shallow, so the demo shows a rep being flagged. */
function bottomOf(k: number): number {
  if (k % 5 === 3) return 121;
  return 90 + ((k * 7) % 5) * 2;
}

function isShallow(k: number): boolean {
  return bottomOf(k) > TARGET_TOP;
}

/** The knee angle at time t. Each rep is a smooth dip with a short rest at the start and end. */
function angleAt(t: number): number {
  const k = Math.floor(t / PERIOD);
  const phase = (t - k * PERIOD) / PERIOD;
  const s = phase < 0.1 || phase > 0.9 ? 0 : Math.sin((Math.PI * (phase - 0.1)) / 0.8) ** 1.7;
  return STANDING - (STANDING - bottomOf(k)) * s;
}

/** The time at the bottom of rep k. */
function troughTime(k: number): number {
  return (k + 0.5) * PERIOD;
}

interface Palette {
  line: string;
  good: string;
  shallow: string;
  band: string;
  ink: string;
  muted: string;
}

/** Read the colours from the page's CSS variables, with fallbacks, so the canvas matches the theme. */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    line: '#ffffff',
    good: get('--color-teal-300', '#6cbfae'),
    shallow: get('--color-clay-400', '#dd8a63'),
    band: 'rgba(108, 191, 174, 0.13)',
    ink: get('--color-ink-900', '#0b1a20'),
    muted: get('--color-ink-200', '#9fb4ba'),
  };
}

/** A canvas animation that imitates the live knee angle graph, with a moving line, a target depth band and a numbered marker for each squat. It is decoration for the sign in page, so the data is made up. */
export function MotionTrace() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = wrap.current;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!host || !el || !ctx) return undefined;
    const palette = readPalette(host);
    const font = getComputedStyle(host).fontFamily;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number, reveal = 1) => {
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);
      const top = height * 0.12;
      const bottom = height * 0.78;
      const y = (angle: number) => top + ((STANDING + 6 - angle) / (STANDING + 6 - 70)) * (bottom - top);
      const nowX = width * NOW_AT;
      const x = (t: number) => nowX - ((now - t) / WINDOW) * nowX;

      // target depth band
      ctx.fillStyle = palette.band;
      ctx.fillRect(0, y(TARGET_TOP), width, y(TARGET_BOTTOM) - y(TARGET_TOP));
      ctx.fillStyle = palette.muted;
      ctx.font = `500 13px ${font}`;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText('Target depth', width - 20, y(TARGET_TOP) - 8);
      ctx.textAlign = 'left';

      // trace fades as readings get older
      const startT = now - WINDOW * (nowX / nowX);
      const fade = ctx.createLinearGradient(0, 0, nowX, 0);
      fade.addColorStop(0, 'rgba(255,255,255,0)');
      fade.addColorStop(0.35, 'rgba(255,255,255,0.9)');
      fade.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, nowX * reveal + 1, height);
      ctx.clip();
      ctx.strokeStyle = fade;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      const steps = Math.ceil(nowX / 3);
      for (let i = 0; i <= steps; i += 1) {
        const t = startT + (i / steps) * (now - startT);
        const px = x(t);
        const py = y(angleAt(Math.max(t, 0)));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // numbered marker under each squat so far
      ctx.font = `600 13px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const firstK = Math.max(0, Math.floor((now - WINDOW) / PERIOD));
      for (let k = firstK; troughTime(k) <= now; k += 1) {
        const px = x(troughTime(k));
        if (px < 24) continue;
        const py = y(bottomOf(k));
        const shallow = isShallow(k);
        const label = shallow ? `${k + 1} shallow` : String(k + 1);
        const w = ctx.measureText(label).width + 18;
        const age = Math.min(1, (now - troughTime(k)) / 0.35);
        ctx.globalAlpha = age * Math.min(1, (px - 24) / 120 + 0.25);
        ctx.fillStyle = shallow ? palette.shallow : palette.good;
        ctx.beginPath();
        ctx.roundRect(px - w / 2, py + 14, w, 24, 12);
        ctx.fill();
        ctx.fillStyle = palette.ink;
        ctx.fillText(label, px, py + 26.5);
        ctx.fillStyle = shallow ? palette.shallow : palette.good;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // now line and live dot
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nowX, top - 14);
      ctx.lineTo(nowX, bottom + 40);
      ctx.stroke();
      const liveY = y(angleAt(now));
      ctx.fillStyle = palette.ink;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(nowX, liveY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = palette.muted;
      ctx.font = `500 13px ${font}`;
      ctx.textBaseline = 'alphabetic';
      const reading = `${Math.round(angleAt(now))}° knee angle`;
      const fitsRight = nowX + 14 + ctx.measureText(reading).width < width - 8;
      ctx.textAlign = fitsRight ? 'left' : 'right';
      ctx.fillText(reading, fitsRight ? nowX + 14 : nowX - 14, Math.max(top - 2, liveY - 16));
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (!motionAllowed()) draw(START);
    });
    observer.observe(host);

    // With reduced motion a single still frame is drawn instead of an animation
    if (!motionAllowed()) {
      draw(START);
      return () => observer.disconnect();
    }

    const begin = performance.now();
    const sweep = { value: 0 };
    const intro = gsap.to(sweep, { value: 1, duration: 1.4, ease: 'power2.out', delay: 0.15 });
    const tick = () => draw(START + (performance.now() - begin) / 1000, sweep.value);
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      intro.kill();
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0">
      <canvas
        ref={canvas}
        role="img"
        aria-label="A live trace of someone's knee angle during squats. Each squat is numbered, and a shallow one is flagged."
        className="block h-full w-full"
      />
    </div>
  );
}
