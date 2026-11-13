import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayFrame } from '../../services/hub/types';
import { Button } from '../../ui/Button';
import { SkeletonCanvas } from './SkeletonCanvas';
import { frameIndexAt, groupLandmarks, replayDuration } from './skeleton';

/** Plays a recorded rep as a looping skeleton, with pause, half speed and a scrubber. Dragging the scrubber pauses it. */
export function ReplayPlayer({ frames, aspect }: { frames: readonly ReplayFrame[]; aspect: number }) {
  const duration = useMemo(() => replayDuration(frames), [frames]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    setTime(0);
    setPlaying(true);
  }, [frames]);

  useEffect(() => {
    if (!playing || duration <= 0) return undefined;
    let handle = 0;
    // Time moves on by the real time between frames, so the speed does not depend on the screen's refresh rate
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setTime((t) => {
        const next = t + dt * (slow ? 0.5 : 1);
        return next > duration ? 0 : next; // loop
      });
      handle = requestAnimationFrame(tick);
    };
    last.current = null;
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, slow, duration]);

  const index = frameIndexAt(frames, time);
  const landmarks = useMemo(() => (index >= 0 ? groupLandmarks(frames[index]!.p) : null), [frames, index]);

  if (frames.length === 0) return <p className="text-sm text-slate-600">No replay was recorded for this rep.</p>;
  return (
    <div className="space-y-2">
      <SkeletonCanvas landmarks={landmarks} aspect={aspect} label="Replay of the captured rep" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause replay' : 'Play replay'} icon={playing ? 'pause' : 'play'}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSlow((s) => !s)} aria-pressed={slow} icon="clock">
          {slow ? 'Half speed' : 'Normal speed'}
        </Button>
        <input
          type="range"
          aria-label="Replay position"
          className="flex-1 accent-teal-600"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(time, duration)}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
      </div>
    </div>
  );
}
