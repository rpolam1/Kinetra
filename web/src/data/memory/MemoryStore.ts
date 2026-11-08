import type { CalibrationRecord, Patient, PatientSession, Prescription, UserAccount } from '../../domain';
import { emptyRegistry } from '../registry';
import type { Registry } from '../registry';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredUser extends UserAccount {
  password: string;
}

interface Snapshot {
  users?: StoredUser[];
  patients: Patient[];
  prescriptions: Record<string, Prescription[]>;
  registry: Registry;
  counter: number;
  sessions?: Record<string, PatientSession[]>;
  calibrations?: Record<string, Record<string, CalibrationRecord>>;
}

const STORAGE_KEY = 'exercise-tracker.demo-db.v1';

export class MemoryStore {
  patients = new Map<string, Patient>();
  prescriptions = new Map<string, Prescription[]>();
  registry: Registry = emptyRegistry();
  sessions = new Map<string, PatientSession[]>();
  calibrations = new Map<string, Record<string, CalibrationRecord>>();
  users = new Map<string, StoredUser>();
  private userListeners = new Set<() => void>();
  private counter = 0;

  constructor(
    private readonly storage?: KeyValueStorage,
    readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter.toString(36).padStart(4, '0')}`;
  }

  usersChanged(): void {
    this.persist();
    for (const listener of this.userListeners) listener();
  }

  watchUsers(listener: () => void): () => void {
    this.userListeners.add(listener);
    return () => this.userListeners.delete(listener);
  }

  persist(): void {
    if (!this.storage) return;
    const snapshot: Snapshot = {
      patients: [...this.patients.values()],
      prescriptions: Object.fromEntries(this.prescriptions),
      registry: this.registry,
      counter: this.counter,
      sessions: Object.fromEntries(this.sessions),
      calibrations: Object.fromEntries(this.calibrations),
      users: [...this.users.values()],
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Snapshot;
      this.patients = new Map(s.patients.map((p) => [p.id, p]));
      this.prescriptions = new Map(Object.entries(s.prescriptions));
      this.registry = s.registry;
      this.sessions = new Map(Object.entries(s.sessions ?? {}));
      this.calibrations = new Map(Object.entries(s.calibrations ?? {}));
      this.users = new Map((s.users ?? []).map((u) => [u.uid, u]));
      this.counter = s.counter;
    } catch {
    }
  }
}
