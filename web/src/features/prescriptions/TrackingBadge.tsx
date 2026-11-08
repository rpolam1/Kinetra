import { TRACKING_LABELS } from '../../domain';
import type { TrackingMode } from '../../domain';
import { Badge } from '../../ui/display';
import type { Tone } from '../../ui/display';

const TONE: Record<TrackingMode, Tone> = { scored: 'green', count_only: 'blue', timed: 'violet', manual: 'slate' };

export function TrackingBadge({ mode }: { mode: TrackingMode }) {
  return <Badge tone={TONE[mode]}>{TRACKING_LABELS[mode]}</Badge>;
}
