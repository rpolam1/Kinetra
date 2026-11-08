import type { Landmark, ReplayFrame } from '../../services/hub/types';

export const BONES: readonly (readonly [number, number])[] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // shoulders and arms
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [27, 29], [29, 31], [28, 30], [30, 32], // feet
  [0, 11], [0, 12], // head to shoulders
];

export const MIN_VISIBILITY = 0.4;

export function groupLandmarks(flat: readonly number[]): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
  return out;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function boneSegments(landmarks: readonly Landmark[], width: number, height: number, minVisibility = MIN_VISIBILITY): Segment[] {
  const segments: Segment[] = [];
  for (const [a, b] of BONES) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q || p[2] < minVisibility || q[2] < minVisibility) continue;
    segments.push({ x1: p[0] * width, y1: p[1] * height, x2: q[0] * width, y2: q[1] * height });
  }
  return segments;
}

export function visibleJoints(landmarks: readonly Landmark[], width: number, height: number, minVisibility = MIN_VISIBILITY): { x: number; y: number }[] {
  const joints: { x: number; y: number }[] = [];
  for (const index of new Set(BONES.flat())) {
    const p = landmarks[index];
    if (p && p[2] >= minVisibility) joints.push({ x: p[0] * width, y: p[1] * height });
  }
  return joints;
}

export interface Palette {
  bone: string;
  joint: string;
  background: string;
}

export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
}

export function drawSkeleton(ctx: DrawContext, landmarks: readonly Landmark[] | null, width: number, height: number, palette: Palette): void {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  if (!landmarks) return;
  ctx.strokeStyle = palette.bone;
  ctx.lineWidth = Math.max(2, width / 160);
  ctx.lineCap = 'round';
  for (const s of boneSegments(landmarks, width, height)) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.fillStyle = palette.joint;
  for (const j of visibleJoints(landmarks, width, height)) {
    ctx.beginPath();
    ctx.arc(j.x, j.y, Math.max(3, width / 110), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function replayDuration(frames: readonly ReplayFrame[]): number {
  return frames.length === 0 ? 0 : frames[frames.length - 1]!.t;
}

export function frameIndexAt(frames: readonly ReplayFrame[], t: number): number {
  if (frames.length === 0) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
