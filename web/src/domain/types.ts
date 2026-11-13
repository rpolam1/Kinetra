/** Shared types for the whole app. Nothing in this file has behaviour. */
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

/** What an instructor enters about a patient. */
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

/** A saved patient. The name keys are lowercase forms of the name that searches compare against. */
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

/** What the hub needs to know about a printed tag. */
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

/** One exercise from the shared library in config/exercises.json. */
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

/** One exercise in a patient's prescription. Reps or seconds is filled in depending on the exercise. */
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

/** The cardio part of a prescription. Intensity is given as a low and a high percentage. */
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

/** One saved version of a patient's prescription. Only the latest is current and older ones are kept as history. */
export interface Prescription extends PrescriptionContent {
  id: string;
  patientId: string;
  version: number;
  status: PrescriptionStatus;
  reason: string;
  createdBy: string;
  createdAt: number;
}

/** The signed in person. The role stays null until an admin approves the account. */
export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role | null;
  status: AccountStatus;
  requestedRole: Role | null;
}

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

/** An account as an admin sees it. Awaiting is true while a request needs a decision. */
export interface UserAccount extends AuthUser {
  awaiting: boolean;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
}
