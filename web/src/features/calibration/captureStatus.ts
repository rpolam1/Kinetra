import type { CalibrationJob, SkeletonFrame } from '../../services/hub/types';

export type HintTone = 'good' | 'warn' | 'neutral';

export interface CaptureHint {
  tone: HintTone;
  text: string;
}

export function describeCapture(job: CalibrationJob | null, frame: SkeletonFrame | null): CaptureHint {
  if (!job) return { tone: 'neutral', text: 'Connecting to the hub…' };
  if (job.status === 'pending') {
    return { tone: 'neutral', text: job.camera_id ? `Waiting for camera ${job.camera_id}…` : 'Waiting for a camera to pick this up. Make sure the camera client is running.' };
  }
  if (job.status === 'cancelled') return { tone: 'warn', text: job.message ?? 'This calibration was cancelled.' };
  if (!frame) return { tone: 'neutral', text: `Camera ${job.camera_id ?? ''} connected. Waiting for video…`.replace('  ', ' ') };
  if (frame.status === 'ok') {
    return frame.phase === 'out' || frame.phase === 'back'
      ? { tone: 'good', text: 'Rep in progress…' }
      : { tone: 'good', text: 'Ready. Ask the patient to do one slow, good rep, then return to the start.' };
  }
  return { tone: 'warn', text: frame.message ?? 'The camera cannot see the patient clearly.' };
}

export function nextPendingIndex(job: CalibrationJob | null): number | null {
  return job?.reps.find((r) => r.status === 'pending')?.index ?? null;
}

export function canFinish(job: CalibrationJob | null): boolean {
  return job !== null && (job.status === 'active' || job.status === 'pending') && job.kept >= job.min_kept && job.camera_id !== null;
}

export function progressText(job: CalibrationJob): string {
  return `${job.kept} of ${job.target_reps} good reps kept` + (job.kept < job.min_kept ? ` (at least ${job.min_kept} needed)` : '');
}
