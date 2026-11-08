export type Light = 'not_detected' | 'resting' | 'on_track' | 'drifting' | 'needs_help' | 'finished';

export type PlanTracking = 'scored' | 'count_only' | 'timed' | 'manual';

export interface PlanItem {
  exercise_id: string;
  name: string;
  tracking: PlanTracking;
  sets: number;
  reps: number | null;
  seconds: number | null;
  load: string;
  modification: string;
}

export interface SessionParticipantInput {
  patient_id: string;
  board_name: string;
  plan: PlanItem[];
}

export interface LiveExercise {
  id: string;
  name: string;
  tracking: PlanTracking;
  sets: number;
  reps: number | null;
  seconds: number | null;
  load: string;
  modification: string;
  index: number;
  total: number;
  next: string | null;
}

export interface LiveProgress {
  reps_done: number;
  target_reps: number | null;
  target_sets: number;
  sets_done: number;
  set_number: number;
  current_set_reps: number;
  target_met: boolean;
}

export interface LiveParticipant {
  patient_id: string;
  board_name: string;
  light: Light;
  reason: string;
  present: boolean;
  cameras: string[];
  exercise: LiveExercise | null;
  progress: LiveProgress | null;
  recent_scores: number[];
  last_rep_at: number | null;
  finished: boolean;
  done_count: number;
}

export interface LiveSnapshot {
  server_time: number;
  session: { id: string; active: boolean; started_at: number; ended_at: number | null; auto_advance: boolean } | null;
  participants: LiveParticipant[];
  unidentified: { camera_id: string; track_key: string }[];
  cameras: { id: string; online: boolean }[];
}

export interface SessionExerciseSummary {
  exercise_id: string;
  name: string;
  tracking: PlanTracking;
  target_sets: number;
  target_reps: number | null;
  reps: number;
  sets: number;
  good: number;
  needs_correction: number;
  flagged: number;
  avg_score: number | null;
  avg_rom?: number | null;
  avg_rep_seconds?: number | null;
  completed: boolean;
}

export interface SessionSummary {
  session_id: string;
  started_at: number;
  ended_at: number;
  participants: { patient_id: string; board_name: string; exercises: SessionExerciseSummary[] }[];
}

export type CalibrationStatus = 'pending' | 'active' | 'finished' | 'cancelled';
export type RepDecision = 'pending' | 'kept' | 'discarded';
export type CaptureStatus =
  | 'ok'
  | 'no_person'
  | 'joints_hidden'
  | 'wrong_person'
  | 'ambiguous'
  | (string & {});

export interface CalibrationRepInfo {
  index: number;
  status: RepDecision;
  rom: number | null;
  duration_sec: number;
  partial_return: boolean;
  n_frames: number;
}

export interface CalibrationJob {
  id: string;
  patient_id: string;
  exercise: string;
  camera_id: string | null;
  status: CalibrationStatus;
  target_reps: number;
  kept: number;
  discarded: number;
  pending: number;
  message: string | null;
  min_kept: number;
  slot: string | null;
  warnings: string[];
  reps: CalibrationRepInfo[];
}

export type Landmark = [number, number, number];

export interface SkeletonFrame {
  job_id: string;
  status: CaptureStatus;
  message: string | null;
  angle: number | null;
  phase: 'rest' | 'out' | 'back' | null;
  reps_sent: number;
  aspect: number;
  landmarks: Landmark[] | null;
}

export interface ReplayFrame {
  t: number;
  p: number[];
}

export interface CalibrationRepDetail {
  index: number;
  status: RepDecision;
  rom: number | null;
  duration_sec: number;
  partial_return: boolean;
  frames: ReplayFrame[];
}

export interface CalibrationResult {
  ok: boolean;
  slot: string;
  kept: number;
  warnings: string[];
}