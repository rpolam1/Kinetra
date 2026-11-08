export type Role = 'admin' | 'instructor' | 'volunteer';

export type ProgramStream = 'general' | 'cancer' | 'stroke' | 'graduate' | 'other';
export type ReferralSource = 'WRHN' | 'GRH' | 'physician' | 'self' | 'other';
export type AffectedSide = 'none' | 'left' | 'right' | 'both';
export type MobilityAid = 'none' | 'cane' | 'walker' | 'wheelchair';
export type FallsRisk = 'low' | 'moderate' | 'high';
export type SupervisionLevel = 'independent' | 'check_in' | 'one_to_one';
export type PatientStatus = 'active' | 'archived';

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface Medication {
  name: string;
  betaBlocker: boolean;
}

export interface BaselineTest {
  name: string;
  result: string;
  date: string;
}

export interface Consent {
  exercise: boolean;
  cameraTracking: boolean;
  signedOn: string;
}

export interface PatientData {
  firstName: string;
  lastName: string;
  boardName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  emergencyContact: EmergencyContact;
  stream: ProgramStream;
  referralSource: ReferralSource;
  referralNotes: string;
  diagnoses: string[];
  medications: Medication[];
  precautions: string;
  affectedSide: AffectedSide;
  mobilityAid: MobilityAid;
  fallsRisk: FallsRisk;
  supervision: SupervisionLevel;
  restingHr: number | null;
  maxHr: number | null;
  baselineTests: BaselineTest[];
  goals: string;
  consent: Consent;
}

export interface Patient extends PatientData {
  id: string;
  code: string;
  tagId: number | null;
  status: PatientStatus;
  nameKey: string;
  nameKeyAlt: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  prescriptionVersion?: number;
}

export interface TagRegistryEntry {
  patientId: string;
  code: string;
  boardName: string;
}
export type TagRegistry = Record<number, TagRegistryEntry>;

export type ExerciseCategory =
  | 'mobility'
  | 'squat_lunge'
  | 'push'
  | 'hinge'
  | 'pull'
  | 'carry'
  | 'core'
  | 'stretch'
  | 'cardio';

export type TrackingMode = 'scored' | 'count_only' | 'timed' | 'manual';
export type ExercisePosition = 'standing' | 'seated' | 'floor' | 'wall';

export interface ExerciseDefinition {
  id: string;
  name: string;
  category: ExerciseCategory;
  tracking: TrackingMode;
  position: ExercisePosition;
  equipment?: string;
  defaultSets: number;
  defaultReps?: number;
  defaultSeconds?: number;
}

export type ProgressionRule = 'twenty_reps_two_sessions' | 'manual';

export interface PrescribedExercise {
  exerciseId: string;
  sets: number;
  reps: number | null;
  seconds: number | null;
  load: string;
  modification: string;
  notes: string;
  progression: ProgressionRule;
}

export type CardioMachine = 'treadmill' | 'recumbent_bike' | 'elliptical' | 'other';

export interface CardioBlock {
  machine: CardioMachine;
  warmupMin: number;
  mainMin: number;
  cooldownMin: number;
  intensityLowPct: number;
  intensityHighPct: number;
  notes: string;
}

export type PrescriptionStatus = 'current' | 'superseded';

export interface PrescriptionContent {
  exercises: PrescribedExercise[];
  cardio: CardioBlock;
}

export interface Prescription extends PrescriptionContent {
  id: string;
  patientId: string;
  version: number;
  status: PrescriptionStatus;
  reason: string;
  createdBy: string;
  createdAt: number;
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role | null;
  status: AccountStatus;
  requestedRole: Role | null;
}

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export interface UserAccount extends AuthUser {
  awaiting: boolean;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
}
