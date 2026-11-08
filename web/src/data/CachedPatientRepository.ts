import { classifySearchQuery } from '../domain';
import type { Patient, PatientData, TagRegistry } from '../domain';
import { DEFAULT_SEARCH_LIMIT } from './repositories';
import type { PatientRepository } from './repositories';

interface Entry<T> {
  value: T;
  at: number;
}

export class CachedPatientRepository implements PatientRepository {
  private searches = new Map<string, Entry<Patient[]>>();
  private recents = new Map<number, Entry<Patient[]>>();
  private byId = new Map<string, Entry<Patient | null>>();

  constructor(
    private readonly inner: PatientRepository,
    private readonly ttlMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private fresh<T>(entry: Entry<T> | undefined): entry is Entry<T> {
    return entry !== undefined && this.now() - entry.at < this.ttlMs;
  }

  private clear(): void {
    this.searches.clear();
    this.recents.clear();
    this.byId.clear();
  }

  async search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    const intent = classifySearchQuery(query);
    if (intent.kind === 'empty') return [];
    const key = `${limit}|${JSON.stringify(intent)}`;
    const hit = this.searches.get(key);
    if (this.fresh(hit)) return hit.value;
    const value = await this.inner.search(query, limit);
    this.searches.set(key, { value, at: this.now() });
    return value;
  }

  async recent(limit: number = DEFAULT_SEARCH_LIMIT): Promise<Patient[]> {
    const hit = this.recents.get(limit);
    if (this.fresh(hit)) return hit.value;
    const value = await this.inner.recent(limit);
    this.recents.set(limit, { value, at: this.now() });
    return value;
  }

  async get(id: string): Promise<Patient | null> {
    const hit = this.byId.get(id);
    if (this.fresh(hit)) return hit.value;
    const value = await this.inner.get(id);
    this.byId.set(id, { value, at: this.now() });
    return value;
  }

  async create(data: PatientData, actorUid: string): Promise<Patient> {
    const p = await this.inner.create(data, actorUid);
    this.clear();
    return p;
  }

  async update(id: string, data: PatientData, actorUid: string): Promise<Patient> {
    const p = await this.inner.update(id, data, actorUid);
    this.clear();
    return p;
  }

  async archive(id: string, actorUid: string): Promise<Patient> {
    const p = await this.inner.archive(id, actorUid);
    this.clear();
    return p;
  }

  async reassignTag(id: string, tagId: number): Promise<Patient> {
    const p = await this.inner.reassignTag(id, tagId);
    this.clear();
    return p;
  }

  tagRegistry(): Promise<TagRegistry> {
    return this.inner.tagRegistry();
  }
}
