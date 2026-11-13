import type { LiveHeartRate } from '../../services/hub/types';
import { Icon } from '../../ui/Icon';
import { HEART_TONES } from './roster';

/** The sentence read out by screen readers for a heart rate update. */
export function heartAnnouncement(heart: LiveHeartRate): string {
  return heart.bpm === null ? heart.message : `${heart.bpm} beats per minute. ${heart.message}`;
}

/** The heart rate for one participant, with a message and the target range. Hidden when no watch is connected. */
export function HeartReadout({ heart }: { heart: LiveHeartRate | undefined }) {
  if (!heart) return null;
  const tone = HEART_TONES[heart.status];
  const zone = heart.zone && heart.status !== 'unreliable' ? `Target ${heart.zone.low} to ${heart.zone.high} bpm` : null;
  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 ${tone.tint}`} role="group" aria-label={`Heart rate: ${heartAnnouncement(heart)}`}>
      <span className={`flex items-center gap-1.5 ${tone.text}`}>
        <Icon name="heart" className={`text-lg ${tone.pulse ? 'motion-safe:animate-pulse' : ''}`} />
        <span className="text-xl font-semibold tabular-nums">{heart.bpm ?? '--'}</span>
        <span className="text-xs font-medium uppercase tracking-wide">bpm</span>
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
        {heart.message}
        {zone ? <span className="block text-xs text-slate-600">{zone}</span> : null}
      </span>
    </div>
  );
}
