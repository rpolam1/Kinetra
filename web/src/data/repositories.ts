/** The interfaces that the rest of the app uses for storage. Both the memory and Firebase versions follow them. */
import type {
  AccountStatus,
  AuthUser,
  CalibrationRecord,
  PatientSession,
  Patient,
  PatientData,
  Prescription,
  PrescriptionContent,
  Role,
  SignUpInput,
  TagRegistry,
  UserAccount,
} from '../domain';

export type DataErrorCode =
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'no_free_tag'
  | 'permission'
  | 'unavailable';

/** An error from the data layer. The code lets screens react without reading the message. */
export class DataError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

/** Reading and writing patients. Search accepts a name prefix, a patient code or a tag number. */
export interface PatientRepository {
  create(data: PatientData, actorUid: string): Promise<Patient>;
  get(id: string): Promise<Patient | null>;
  update(id: string, data: PatientData, actorUid: string): Promise<Patient>;
  search(query: string, limit?: number): Promise<Patient[]>;
  recent(limit?: number): Promise<Patient[]>;
  archive(id: string, actorUid: string): Promise<Patient>;
  reassignTag(id: string, tagId: number): Promise<Patient>;
  tagRegistry(): Promise<TagRegistry>;
}

/** Prescriptions are versioned. Saving adds a new version and keeps the older ones. */
export interface PrescriptionRepository {
  current(patientId: string): Promise<Prescription | null>;
  history(patientId: string, limit?: number): Promise<Prescription[]>;
  save(
    patientId: string,
    content: PrescriptionContent,
    reason: string,
    actorUid: string,
  ): Promise<Prescription>;
}

/** Finished sessions for each patient. */
export interface SessionRepository {
  save(session: PatientSession): Promise<void>;
  forPatient(patientId: string, limit?: number): Promise<PatientSession[]>;
}

/** Which exercises have been calibrated for a patient. */
export interface CalibrationRepository {
  save(patientId: string, record: CalibrationRecord): Promise<void>;
  forPatient(patientId: string): Promise<CalibrationRecord[]>;
}

/** Signing in and out. Demo is true when accounts are only kept in the browser. */
export interface AuthService {
  readonly demo: boolean;
  current(): AuthUser | null;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(input: SignUpInput): Promise<AuthUser>;
  requestRole(role: Role): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
}

/** Account approval for admins. */
export interface AccountRepository {
  watch(onChange: (accounts: UserAccount[]) => void, onError: (error: Error) => void): () => void;
  approve(uid: string, role: Role, actorUid: string): Promise<void>;
  reject(uid: string, actorUid: string): Promise<void>;
  setRole(uid: string, role: Role, actorUid: string): Promise<void>;
  setStatus(uid: string, status: Extract<AccountStatus, 'approved' | 'disabled'>, actorUid: string): Promise<void>;
}

/** Everything the app needs from storage. The memory and Firebase versions have the same shape, so the rest of the app does not know which one is in use. */
export interface DataLayer {
  readonly mode: 'memory' | 'firebase';
  readonly patients: PatientRepository;
  readonly prescriptions: PrescriptionRepository;
  readonly sessions: SessionRepository;
  readonly calibrations: CalibrationRepository;
  readonly auth: AuthService;
  readonly accounts: AccountRepository;
}

export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_HISTORY_LIMIT = 50;
