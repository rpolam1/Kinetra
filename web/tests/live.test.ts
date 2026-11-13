/** Tests for the live parts: the event stream parser, hub live calls, skeleton drawing, calibration status, the roster and saved session records. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryPatientRepository } from '../src/data/memory/MemoryPatientRepository';
import { MemoryCalibrationRepository, MemorySessionRepository } from '../src/data/memory/MemorySessionRepository';
import { MemoryStore } from '../src/data/memory/MemoryStore';
import type { KeyValueStorage } from '../src/data/memory/MemoryStore';
import { calibrationSlot, emptyPatientData, exerciseTrend, exercisesSeen, getExercise, newPrescribedExercise, sessionsFromSummary, slotDocId } from '../src/domain';
import type { PatientSession, Prescription } from '../src/domain';
import { describeCapture, canFinish, nextPendingIndex, progressText } from '../src/features/calibration/captureStatus';
import { BONES, boneSegments, drawSkeleton, frameIndexAt, groupLandmarks, replayDuration } from '../src/features/calibration/skeleton';
import type { DrawContext } from '../src/features/calibration/skeleton';
import { countByLight, planFromPrescription, prescriptionLine, progressLabel, rosterProblems, sortByNeed } from '../src/features/session/roster';
import { HubApi } from '../src/services/hub/HubApi';
import { SseParser, openStream } from '../src/services/hub/sse';
import type { StreamState } from '../src/services/hub/sse';
import type { CalibrationJob, LiveParticipant, Landmark, SessionSummary, SkeletonFrame } from '../src/services/hub/types';

describe('SseParser', () => {
  it('assembles messages split across chunks, ignoring comments', () => {
    const p = new SseParser();
    assert.deepEqual(p.push(': connected\n\nid: 7\nevent: sta'), []);
    const out = p.push('tus\ndata: {"a":1}\n\n');
    assert.deepEqual(out, [{ event: 'status', data: '{"a":1}', id: '7' }]);
  });
  it('handles CRLF, several messages in one chunk and multi-line data', () => {
    const out = new SseParser().push('event: x\r\ndata: 1\r\ndata: 2\r\n\r\ndata: solo\n\n');
    assert.deepEqual(out.map((m) => [m.event, m.data]), [['x', '1\n2'], ['message', 'solo']]);
  });
  it('drops keep-alive-only blocks', () => {
    assert.deepEqual(new SseParser().push(': keep-alive\n\n'), []);
  });
});

/** A fake streaming response that sends the given chunks and can be held open until a promise settles. */
function streamOf(chunks: string[], hold?: Promise<void>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (hold) await hold;
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Polls until a condition is true, and fails the test if it takes too long. */
const waitFor = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('openStream', () => {
  it('delivers messages, sends the API key, and reconnects after the stream drops', async () => {
    const seen: string[] = [];
    const states: StreamState[] = [];
    const headers: (string | null)[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      headers.push(new Headers(init?.headers).get('X-API-Key'));
      return streamOf([`event: status\ndata: "call${calls}"\n\n`]);
    }) as unknown as typeof fetch;
    const stop = openStream({
      url: 'http://hub/api/stream', fetchImpl, headers: () => ({ 'X-API-Key': 'k' }),
      onMessage: (m) => seen.push(m.data), onState: (s) => states.push(s),
      sleep: () => new Promise((r) => setTimeout(r, 2)),
    });
    await waitFor(() => seen.length >= 2);
    stop();
    assert.deepEqual(seen.slice(0, 2), ['"call1"', '"call2"']);
    assert.equal(headers[0], 'k');
    assert.ok(states.includes('open') && states.includes('reconnecting'));
  });

  it('stops for good on 401 instead of hammering the hub', async () => {
    let calls = 0;
    const states: StreamState[] = [];
    const fetchImpl = (async () => { calls += 1; return new Response('no', { status: 401 }); }) as unknown as typeof fetch;
    openStream({ url: 'u', fetchImpl, onMessage: () => undefined, onState: (s) => states.push(s), sleep: async () => undefined });
    await waitFor(() => states.includes('unauthorized'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 1);
  });

  it('keeps retrying with backoff while the hub is unreachable, and stops when closed', async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImpl = (async () => { calls += 1; throw new TypeError('network'); }) as unknown as typeof fetch;
    const stop = openStream({
      url: 'u', fetchImpl, onMessage: () => undefined, minDelayMs: 100, maxDelayMs: 400,
      sleep: async (ms) => { delays.push(ms); await new Promise((r) => setTimeout(r, 1)); },
    });
    await waitFor(() => calls >= 5);
    stop();
    assert.deepEqual(delays.slice(0, 4), [100, 200, 400, 400]);
    const after = calls;
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(calls <= after + 1);
  });
});

describe('HubApi live endpoints', () => {
  function recorder(body: unknown = {}) {
    const calls: { url: string; method: string; body: unknown; key: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, key: new Headers(init?.headers).get('X-API-Key') });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, api: new HubApi({ baseUrl: 'http://hub:5000/', fetchImpl, apiKey: () => 'secret' }) };
  }

  it('starts a session and ends it, returning the summary', async () => {
    const { calls, api } = recorder({ summary: { session_id: 's1' } });
    await api.startSession([{ patient_id: 'P-0001', board_name: 'Ana K.', plan: [] }], true);
    const summary = await api.endSession();
    assert.equal(summary.session_id, 's1');
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['PUT', 'http://hub:5000/api/session'], ['POST', 'http://hub:5000/api/session/end']]);
    assert.deepEqual(calls[0]!.body, { participants: [{ patient_id: 'P-0001', board_name: 'Ana K.', plan: [] }], auto_advance: true });
    assert.equal(calls[0]!.key, 'secret');
  });

  it('maps keep / discard and builds calibration URLs safely', async () => {
    const { calls, api } = recorder({});
    await api.createCalibration('P-0001', 'goblet_squat', null, 5);
    await api.decideRep('job 1', 3, 'kept');
    await api.decideRep('job 1', 4, 'discarded');
    await api.getCalibrationRep('job 1', 2);
    assert.deepEqual(calls[0]!.body, { patient_id: 'P-0001', exercise: 'goblet_squat', camera_id: null, target_reps: 5 });
    assert.equal(calls[1]!.url, 'http://hub:5000/api/calibration/job%201/reps/3/decision');
    assert.deepEqual(calls[1]!.body, { decision: 'keep' });
    assert.deepEqual(calls[2]!.body, { decision: 'discard' });
    assert.equal(calls[3]!.url, 'http://hub:5000/api/calibration/job%201/reps/2');
  });

  it('subscribes with the topic list, the job and the API key header', async () => {
    const urls: string[] = [];
    const keys: (string | null)[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      keys.push(new Headers(init?.headers).get('X-API-Key'));
      return new Response('x', { status: 401 });
    }) as unknown as typeof fetch;
    const api = new HubApi({ baseUrl: 'http://hub', fetchImpl, apiKey: () => 'k2' });
    const states: StreamState[] = [];
    const stop = api.subscribe(['calibration', 'skeleton'], { onMessage: () => undefined, onState: (s) => states.push(s) }, 'abc');
    await waitFor(() => states.includes('unauthorized'));
    stop();
    assert.equal(urls[0], 'http://hub/api/stream?topics=calibration%2Cskeleton&job=abc');
    assert.equal(keys[0], 'k2');
  });
});

/** A landmark with a position and a visibility score. */
const lm = (x: number, y: number, v = 0.9): Landmark => [x, y, v];

describe('skeleton helpers', () => {
  const body: Landmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  it('scales bones to the canvas and skips low-visibility joints', () => {
    const marks = body.map((p) => [...p] as Landmark);
    marks[11] = lm(0.25, 0.5); marks[12] = lm(0.75, 0.5);
    marks[13] = lm(0.1, 0.9, 0.1);                 // elbow hidden
    const segs = boneSegments(marks, 640, 480);
    assert.ok(segs.some((s) => s.x1 === 160 && s.x2 === 480 && s.y1 === 240));
    const shoulderToElbow = boneSegments(marks, 640, 480).filter((s) => s.x2 === 64 || s.x1 === 64);
    assert.equal(shoulderToElbow.length, 0);
    assert.ok(BONES.length >= 15);
  });
  it('groups a flat list and finds the right replay frame', () => {
    assert.deepEqual(groupLandmarks([1, 2, 3, 4, 5, 6]), [[1, 2, 3], [4, 5, 6]]);
    const frames = [{ t: 0, p: [] }, { t: 0.1, p: [] }, { t: 0.25, p: [] }, { t: 0.4, p: [] }];
    assert.equal(frameIndexAt(frames, 0), 0);
    assert.equal(frameIndexAt(frames, 0.2), 1);
    assert.equal(frameIndexAt(frames, 99), 3);
    assert.equal(frameIndexAt([], 1), -1);
    assert.equal(replayDuration(frames), 0.4);
    assert.equal(replayDuration([]), 0);
  });
  it('draws only what is visible and clears the canvas first', () => {
    const ops: string[] = [];
    const ctx: DrawContext = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: 'butt',
      fillRect: () => ops.push('clear'), beginPath: () => undefined, moveTo: () => undefined, lineTo: () => ops.push('bone'),
      stroke: () => undefined, arc: () => ops.push('joint'), fill: () => undefined,
    };
    drawSkeleton(ctx, null, 100, 100, { bone: 'a', joint: 'b', background: 'c' });
    assert.deepEqual(ops, ['clear']);
    ops.length = 0;
    drawSkeleton(ctx, body, 100, 100, { bone: 'a', joint: 'b', background: 'c' });
    assert.equal(ops[0], 'clear');
    assert.ok(ops.includes('bone') && ops.includes('joint'));
  });
});

/** A calibration job with defaults. */
function job(over: Partial<CalibrationJob> = {}): CalibrationJob {
  return { id: 'j', patient_id: 'P-0001', exercise: 'goblet_squat', camera_id: 'lab-1', status: 'active', target_reps: 5, kept: 0, discarded: 0, pending: 0, message: null, min_kept: 3, slot: null, warnings: [], reps: [], ...over };
}
/** A skeleton frame with defaults. */
const frame = (over: Partial<SkeletonFrame> = {}): SkeletonFrame => ({ job_id: 'j', status: 'ok', message: null, angle: 170, phase: 'rest', reps_sent: 0, aspect: 1.33, landmarks: null, ...over });

describe('calibration status helpers', () => {
  it('explains what the camera sees', () => {
    assert.equal(describeCapture(null, null).tone, 'neutral');
    assert.match(describeCapture(job({ status: 'pending', camera_id: null }), null).text, /Waiting for a camera/);
    assert.equal(describeCapture(job(), frame()).tone, 'good');
    assert.match(describeCapture(job(), frame({ phase: 'out' })).text, /in progress/);
    const warn = describeCapture(job(), frame({ status: 'joints_hidden', message: 'Step back' }));
    assert.deepEqual(warn, { tone: 'warn', text: 'Step back' });
    assert.equal(describeCapture(job({ status: 'cancelled', message: 'Expired' }), null).text, 'Expired');
  });
  it('finds the next rep to review and knows when finishing is allowed', () => {
    const reps = [1, 2, 3].map((i) => ({ index: i, status: i === 2 ? ('pending' as const) : ('kept' as const), rom: 90, duration_sec: 2, partial_return: false, n_frames: 30 }));
    assert.equal(nextPendingIndex(job({ reps })), 2);
    assert.equal(nextPendingIndex(job()), null);
    assert.equal(canFinish(job({ kept: 2 })), false);
    assert.equal(canFinish(job({ kept: 3 })), true);
    assert.equal(canFinish(job({ kept: 3, camera_id: null })), false);
    assert.equal(canFinish(job({ kept: 5, status: 'finished' })), false);
    assert.match(progressText(job({ kept: 1 })), /at least 3 needed/);
  });
});

/** A stored patient with a two exercise prescription. */
async function patientWithPrescription() {
  const store = new MemoryStore(undefined, () => 1000);
  const repo = new MemoryPatientRepository(store);
  const patient = await repo.create({ ...emptyPatientData(), firstName: 'Ana', lastName: 'Kowalski', boardName: 'Ana K.', dateOfBirth: '1950-01-01', consent: { exercise: true, cameraTracking: true, signedOn: '2026-01-01' } }, 'u');
  const squat = getExercise('goblet_squat')!;
  const prescription: Prescription = {
    id: 'rx', patientId: patient.id, version: 1, status: 'current', reason: '', createdBy: 'u', createdAt: 1,
    exercises: [{ ...newPrescribedExercise(squat), reps: 8, sets: 2, load: '5 lb' }, { ...newPrescribedExercise(squat), exerciseId: 'not_in_library' }],
    cardio: { machine: 'other', warmupMin: 0, mainMin: 0, cooldownMin: 0, intensityLowPct: 40, intensityHighPct: 60, notes: '' },
  };
  return { patient, prescription };
}

/** A live participant with defaults. */
function person(over: Partial<LiveParticipant>): LiveParticipant {
  return { patient_id: 'P', board_name: 'X', light: 'on_track', reason: '', present: true, cameras: [], exercise: null, progress: null, recent_scores: [], last_rep_at: null, finished: false, done_count: 0, ...over };
}

describe('roster', () => {
  it('builds the plan from the prescription and skips exercises no longer in the library', async () => {
    const { prescription } = await patientWithPrescription();
    const plan = planFromPrescription(prescription);
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0], { exercise_id: 'goblet_squat', name: getExercise('goblet_squat')!.name, tracking: 'scored', sets: 2, reps: 8, seconds: null, load: '5 lb', modification: '' });
  });
  it('blocks people who cannot be tracked and only warns about missing calibration', async () => {
    const { patient, prescription } = await patientWithPrescription();
    assert.deepEqual(rosterProblems(patient, prescription, []), []);
    const note = rosterProblems(patient, prescription, ['Goblet squat']);
    assert.equal(note.length, 1);
    assert.equal(note[0]!.blocking, false);
    assert.ok(rosterProblems(patient, null, []).some((p) => p.blocking && /prescription/.test(p.text)));
    assert.ok(rosterProblems({ ...patient, consent: { ...patient.consent, cameraTracking: false } }, prescription, []).some((p) => p.blocking && /consent/.test(p.text)));
    assert.ok(rosterProblems({ ...patient, status: 'archived' }, prescription, []).some((p) => p.blocking));
  });
  it('sorts the people who need help first and keeps roster order otherwise', () => {
    const ordered = sortByNeed([person({ patient_id: 'a', light: 'on_track' }), person({ patient_id: 'b', light: 'needs_help' }), person({ patient_id: 'c', light: 'on_track' }), person({ patient_id: 'd', light: 'drifting' })]);
    assert.deepEqual(ordered.map((p) => p.patient_id), ['b', 'd', 'a', 'c']);
    assert.equal(countByLight(ordered).on_track, 2);
  });
  it('writes the progress and prescription lines', () => {
    const ex = { id: 'x', name: 'Squat', tracking: 'scored' as const, sets: 3, reps: 10, seconds: null, load: '5 lb', modification: 'chair-assisted', index: 0, total: 2, next: null };
    assert.equal(prescriptionLine(ex), '3 × 10, 5 lb (chair-assisted)');
    assert.equal(prescriptionLine({ ...ex, load: '', modification: '' }), '3 × 10');
    assert.equal(prescriptionLine({ ...ex, tracking: 'timed', reps: null, seconds: 30, load: '', modification: '' }), '3 × 30 s');
    const progress = { reps_done: 14, target_reps: 10, target_sets: 3, sets_done: 1, set_number: 2, current_set_reps: 4, target_met: false };
    assert.equal(progressLabel(ex, progress), 'Set 2 of 3 · 4 of 10 reps');
    assert.equal(progressLabel({ ...ex, reps: null }, progress), 'Set 2 of 3');
  });
});

const summary: SessionSummary = {
  session_id: 's1', started_at: 1000, ended_at: 1600,
  participants: [
    { patient_id: 'P-0001', board_name: 'Ana K.', exercises: [
      { exercise_id: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', target_sets: 2, target_reps: 5, reps: 10, sets: 2, good: 8, needs_correction: 1, flagged: 1, avg_score: 82.5, completed: true },
      { exercise_id: 'bird_dog', name: 'Bird dog', tracking: 'manual', target_sets: 1, target_reps: null, reps: 0, sets: 0, good: 0, needs_correction: 0, flagged: 0, avg_score: null, completed: false }] },
    { patient_id: 'P-0002', board_name: 'Bo L.', exercises: [{ exercise_id: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', target_sets: 1, target_reps: 5, reps: 0, sets: 0, good: 0, needs_correction: 0, flagged: 0, avg_score: null, completed: false }] },
    { patient_id: 'P-0003', board_name: 'Stranger', exercises: [{ exercise_id: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', target_sets: 1, target_reps: 5, reps: 5, sets: 1, good: 5, needs_correction: 0, flagged: 0, avg_score: 90, completed: true }] },
  ],
};

describe('session records', () => {
  it('turns the hub summary into one record per active, known patient (milliseconds)', () => {
    const records = sessionsFromSummary(summary, { 'P-0001': 'pat_a', 'P-0002': 'pat_b' }, 'uid1');
    assert.equal(records.length, 1);                      // Bo did nothing, Stranger is unknown
    const r = records[0]!;
    assert.deepEqual([r.id, r.patientId, r.startedAt, r.endedAt, r.savedBy], ['s1', 'pat_a', 1_000_000, 1_600_000, 'uid1']);
    assert.equal(r.exercises[0]!.needsCorrection, 1);
    assert.equal(r.exercises[0]!.avgScore, 82.5);
  });

  function session(id: string, startedAt: number, avg: number | null, reps = 10): PatientSession {
    return { id, patientId: 'p', startedAt, endedAt: startedAt + 1, savedBy: 'u', exercises: [{ exerciseId: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', targetSets: 1, targetReps: 10, reps, sets: 1, good: reps - 2, needsCorrection: 1, flagged: 1, avgScore: avg, completed: true }] };
  }
  it('builds trends oldest first and skips sessions without the exercise', () => {
    const other: PatientSession = { ...session('x', 5, 50), exercises: [] };
    const points = exerciseTrend([session('b', 200, 80), session('a', 100, 70), other], 'goblet_squat');
    assert.deepEqual(points.map((p) => [p.sessionId, p.avgScore]), [['a', 70], ['b', 80]]);
    assert.equal(points[0]!.goodShare, 0.8);
    assert.deepEqual(exercisesSeen([session('a', 100, 70)]), [{ exerciseId: 'goblet_squat', name: 'Goblet squat' }]);
  });

  it('keeps stored sessions newest first, replaces re-saves, and survives a reload', async () => {
    const backing = new Map<string, string>();
    const storage: KeyValueStorage = { getItem: (k) => backing.get(k) ?? null, setItem: (k, v) => void backing.set(k, v) };
    const store = new MemoryStore(storage, () => 1);
    const patients = new MemoryPatientRepository(store);
    const p = await patients.create({ ...emptyPatientData(), firstName: 'Ana', lastName: 'K', boardName: 'Ana K.', dateOfBirth: '1950-01-01' }, 'u');
    const sessions = new MemorySessionRepository(store);
    await sessions.save({ ...session('a', 100, 70), patientId: p.id });
    await sessions.save({ ...session('b', 200, 80), patientId: p.id });
    await sessions.save({ ...session('a', 100, 99), patientId: p.id });            // retry of the same session
    const listed = await sessions.forPatient(p.id);
    assert.deepEqual(listed.map((s) => s.id), ['b', 'a']);
    assert.equal(listed[1]!.exercises[0]!.avgScore, 99);
    await assert.rejects(sessions.save({ ...session('z', 1, 1), patientId: 'nobody' }));

    const calibrations = new MemoryCalibrationRepository(store);
    const slot = calibrationSlot('goblet_squat', 'lab/1');
    assert.equal(slotDocId(slot), 'goblet_squat@lab_1');
    await calibrations.save(p.id, { slot, exerciseId: 'goblet_squat', cameraId: 'lab/1', keptReps: 4, warnings: [], calibratedAt: 1, calibratedBy: 'u' });
    await calibrations.save(p.id, { slot, exerciseId: 'goblet_squat', cameraId: 'lab/1', keptReps: 5, warnings: ['x'], calibratedAt: 2, calibratedBy: 'u' });
    assert.equal((await calibrations.forPatient(p.id)).length, 1);

    const reloaded = new MemoryStore(storage, () => 1);
    assert.deepEqual((await new MemorySessionRepository(reloaded).forPatient(p.id)).map((s) => s.id), ['b', 'a']);
    assert.equal((await new MemoryCalibrationRepository(reloaded).forPatient(p.id))[0]!.keptReps, 5);
  });
});
