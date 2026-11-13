import type { TagRegistry } from '../../domain';
import type {
  CalibrationJob,
  CalibrationRepDetail,
  CalibrationResult,
  LiveSnapshot,
  RepDecision,
  SessionParticipantInput,
  SessionSummary,
} from './types';
import { openStream } from './sse';
import type { SseMessage, StreamState } from './sse';

/** An error from talking to the hub. The status is null when the hub could not be reached. */
export class HubError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'HubError';
    this.status = status;
  }
}

export interface HubTagEntry {
  patient_id: string;
  display_name: string | null;
}

export interface HubState {
  server_time: number;
  set_gap_seconds: number;
  assignments: Record<string, { exercise: string }>;
  tags: Record<string, HubTagEntry>;
  tags_managed: boolean;
  cameras: Record<string, { last_seen: number | null; events: number }>;
}

export interface HubApiOptions {
  baseUrl?: string;
  apiKey?: () => string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Client for the hub's HTTP API. The address is blank when the hub serves the app itself, so requests stay on the same origin. */
export class HubApi {
  private readonly baseUrl: string;
  private readonly apiKey: () => string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HubApiOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? (() => null);
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** Address of a printable tag image. It is a plain URL because an image tag cannot send an API key, and the hub allows these requests without one. */
  tagImageUrl(tagId: number, sizePx = 600): string {
    return `${this.baseUrl}/api/tags/${tagId}.png?size=${sizePx}`;
  }

  async health(): Promise<{ ok: boolean; name?: string }> {
    return this.request('GET', '/api/health');
  }

  getState(): Promise<HubState> {
    return this.request('GET', '/api/state');
  }

  async getTags(): Promise<Record<string, HubTagEntry>> {
    const body = await this.request<{ tags: Record<string, HubTagEntry> }>('GET', '/api/tags');
    return body.tags;
  }

  async setTag(tagId: number, patientId: string, displayName: string): Promise<void> {
    await this.request('PUT', `/api/tags/${tagId}`, { patient_id: patientId, display_name: displayName });
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.request('DELETE', `/api/tags/${tagId}`);
  }

  /** Replace every tag on the hub with the registry. The hub identifies patients by their code. */
  async replaceTags(registry: TagRegistry): Promise<number> {
    const tags: Record<string, HubTagEntry> = {};
    for (const [id, entry] of Object.entries(registry)) {
      tags[id] = { patient_id: entry.code, display_name: entry.boardName };
    }
    const body = await this.request<{ count: number }>('PUT', '/api/tags', { tags });
    return body.count;
  }

  getLive(): Promise<LiveSnapshot> {
    return this.request('GET', '/api/live');
  }

  async startSession(participants: SessionParticipantInput[], autoAdvance: boolean): Promise<void> {
    await this.request('PUT', '/api/session', { participants, auto_advance: autoAdvance });
  }

  async endSession(): Promise<SessionSummary> {
    return (await this.request<{ summary: SessionSummary }>('POST', '/api/session/end')).summary;
  }

  async advance(patientId: string, toIndex?: number): Promise<void> {
    await this.request('POST', '/api/session/advance', { patient_id: patientId, to_index: toIndex });
  }

  async setAutoAdvance(enabled: boolean): Promise<void> {
    await this.request('POST', '/api/session/auto-advance', { enabled });
  }

  createCalibration(patientId: string, exercise: string, cameraId: string | null, targetReps: number): Promise<CalibrationJob> {
    return this.request('POST', '/api/calibration', {
      patient_id: patientId,
      exercise,
      camera_id: cameraId,
      target_reps: targetReps,
    });
  }

  getCalibration(jobId: string): Promise<CalibrationJob> {
    return this.request('GET', `/api/calibration/${encodeURIComponent(jobId)}`);
  }

  getCalibrationRep(jobId: string, index: number): Promise<CalibrationRepDetail> {
    return this.request('GET', `/api/calibration/${encodeURIComponent(jobId)}/reps/${index}`);
  }

  decideRep(jobId: string, index: number, decision: Exclude<RepDecision, 'pending'>): Promise<CalibrationJob> {
    // The hub's words for the decision are keep and discard
    const verb = decision === 'kept' ? 'keep' : 'discard';
    return this.request('POST', `/api/calibration/${encodeURIComponent(jobId)}/reps/${index}/decision`, { decision: verb });
  }

  finishCalibration(jobId: string): Promise<CalibrationResult> {
    return this.request('POST', `/api/calibration/${encodeURIComponent(jobId)}/finish`);
  }

  cancelCalibration(jobId: string): Promise<CalibrationJob> {
    return this.request('POST', `/api/calibration/${encodeURIComponent(jobId)}/cancel`);
  }

  /** Listen to live updates. Returns a function that stops listening. */
  subscribe(
    topics: readonly ('status' | 'calibration' | 'skeleton')[],
    handlers: { onMessage: (message: SseMessage) => void; onState?: (state: StreamState) => void },
    jobId?: string,
  ): () => void {
    const query = new URLSearchParams({ topics: topics.join(',') });
    if (jobId) query.set('job', jobId);
    return openStream({
      url: `${this.baseUrl}/api/stream?${query.toString()}`,
      headers: (): Record<string, string> => {
        const key = this.apiKey();
        const headers: Record<string, string> = {};
        if (key) headers['X-API-Key'] = key;
        return headers;
      },
      fetchImpl: this.fetchImpl,
      onMessage: handlers.onMessage,
      onState: handlers.onState,
    });
  }

  /** Send a request with a timeout and turn failures into a HubError with a readable message. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const key = this.apiKey();
    if (key) headers['X-API-Key'] = key;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new HubError('Cannot reach the hub. Is it running on this network?', null);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) throw new HubError('The hub needs an API key (set it in Settings).', 401);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = ((await response.json()) as { error?: string }).error ?? detail;
      } catch {
      }
      throw new HubError(`Hub error: ${detail}`, response.status);
    }
    return (await response.json()) as T;
  }
}
