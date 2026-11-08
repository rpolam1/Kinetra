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

export class DataError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

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

export interface SessionRepository {
  save(session: PatientSession): Promise<void>;
  forPatient(patientId: string, limit?: number): Promise<PatientSession[]>;
}

export interface CalibrationRepository {
  save(patientId: string, record: CalibrationRecord): Promise<void>;
  forPatient(patientId: string): Promise<CalibrationRecord[]>;
}

export interface AuthService {
  readonly demo: boolean;
  current(): AuthUser | null;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(input: SignUpInput): Promise<AuthUser>;
  requestRole(role: Role): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
}

export interface AccountRepository {
  watch(onChange: (accounts: UserAccount[]) => void, onError: (error: Error) => void): () => void;
  approve(uid: string, role: Role, actorUid: string): Promise<void>;
  reject(uid: string, actorUid: string): Promise<void>;
  setRole(uid: string, role: Role, actorUid: string): Promise<void>;
  setStatus(uid: string, status: Extract<AccountStatus, 'approved' | 'disabled'>, actorUid: string): Promise<void>;
}

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
