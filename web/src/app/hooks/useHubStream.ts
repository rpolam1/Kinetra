import { useEffect, useRef, useState } from 'react';
import { useHub } from '../providers/HubProvider';
import type { StreamState } from '../../services/hub/sse';
import type { CalibrationJob, LiveSnapshot, SkeletonFrame } from '../../services/hub/types';

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function useLiveSnapshot(enabled = true): { snapshot: LiveSnapshot | null; state: StreamState } {
  const { api, settings } = useHub();
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    if (!enabled) return undefined;
    return api.subscribe(
      ['status'],
      {
        onMessage: (m) => {
          if (m.event !== 'status') return;
          const next = parse<LiveSnapshot>(m.data);
          if (next) setSnapshot(next);
        },
        onState: setState,
      },
    );
    // api key is a dep, so changing it in settings reconnects
  }, [api, enabled, settings.apiKey]);

  return { snapshot, state };
}

export function useCalibrationStream(jobId: string | null): {
  job: CalibrationJob | null;
  frame: SkeletonFrame | null;
  state: StreamState;
} {
  const { api, settings } = useHub();
  const [job, setJob] = useState<CalibrationJob | null>(null);
  const [frame, setFrame] = useState<SkeletonFrame | null>(null);
  const [state, setState] = useState<StreamState>('connecting');
  const latestJob = useRef<string | null>(jobId);
  latestJob.current = jobId;

  useEffect(() => {
    setJob(null);
    setFrame(null);
    if (!jobId) return undefined;
    return api.subscribe(
      ['calibration', 'skeleton'],
      {
        onMessage: (m) => {
          if (m.event === 'calibration') {
            const next = parse<CalibrationJob>(m.data);
            if (next && next.id === latestJob.current) setJob(next);
          } else if (m.event === 'skeleton') {
            const next = parse<SkeletonFrame>(m.data);
            if (next && next.job_id === latestJob.current) setFrame(next);
          }
        },
        onState: setState,
      },
      jobId,
    );
  }, [api, jobId, settings.apiKey]);

  return { job, frame, state };
}
