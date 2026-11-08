import { useEffect, useMemo, useRef, useState } from 'react';
import { getExercise } from '../../domain';
import type { CalibrationRecord, Patient } from '../../domain';
import { calibrationSlot } from '../../domain';
import { useAsync } from '../../app/hooks/useAsync';
import { useCalibrationStream, useLiveSnapshot } from '../../app/hooks/useHubStream';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { useHub } from '../../app/providers/HubProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { HubError } from '../../services/hub/HubApi';
import type { CalibrationJob, CalibrationResult } from '../../services/hub/types';
import { Button } from '../../ui/Button';
import { NumberField, SelectField } from '../../ui/fields';
import { Alert, Badge, Card } from '../../ui/display';
import { ReplayPlayer } from './ReplayPlayer';
import { SkeletonCanvas } from './SkeletonCanvas';
import { canFinish, describeCapture, nextPendingIndex, progressText } from './captureStatus';

const HINT_TONE = { good: 'green', warn: 'amber', neutral: 'slate' } as const;
const DEFAULT_REPS = 5;

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function CalibrationPanel({ patient, exerciseId, onClose, onSaved }: { patient: Patient; exerciseId: string; onClose: () => void; onSaved: (record: CalibrationRecord) => void }) {
  const { api, status } = useHub();
  const { calibrations } = useData();
  const { user } = useAuth();
  const toast = useToast();
  const exercise = getExercise(exerciseId);

  const [jobId, setJobId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState('');
  const [targetReps, setTargetReps] = useState(DEFAULT_REPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const { snapshot } = useLiveSnapshot(jobId === null);
  const { job, frame } = useCalibrationStream(jobId);
  const onlineCameras = snapshot?.cameras.filter((c) => c.online) ?? [];

  // jump to the newest rep when the camera uploads it
  const repCount = job?.reps.length ?? 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (repCount > lastCount.current) setSelected(repCount);
    lastCount.current = repCount;
  }, [repCount]);

  const detail = useAsync(
    () => (jobId && selected ? api.getCalibrationRep(jobId, selected) : Promise.resolve(null)),
    [api, jobId, selected],
  );

  const hint = useMemo(() => describeCapture(job, frame), [job, frame]);

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(e instanceof HubError || e instanceof Error ? e.message : message(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const created = await run(() => api.createCalibration(patient.code, exerciseId, cameraId || null, targetReps));
    if (created) {
      lastCount.current = 0;
      setSelected(null);
      setJobId(created.id);
    }
  }

  async function decide(index: number, decision: 'kept' | 'discarded') {
    const updated = await run(() => api.decideRep(jobId!, index, decision));
    if (updated) {
      const next = nextPendingIndex(updated);
      if (next !== null) setSelected(next);
    }
  }

  async function finish() {
    if (!job || !user) return;
    const done = await run(() => api.finishCalibration(job.id));
    if (!done) return;
    setResult(done);
    const record: CalibrationRecord = {
      slot: done.slot || calibrationSlot(exerciseId, job.camera_id ?? 'unknown'),
      exerciseId,
      cameraId: job.camera_id ?? 'unknown',
      keptReps: done.kept,
      warnings: done.warnings,
      calibratedAt: Date.now(),
      calibratedBy: user.uid,
    };
    try {
      await calibrations.save(patient.id, record);
      onSaved(record);
      toast.success(`${exercise?.name ?? exerciseId} calibrated`);
    } catch (e) {
      // template is on the hub, only the cloud note failed
      toast.error(`Calibrated, but the cloud record was not saved: ${message(e)}`);
    }
  }

  async function cancel() {
    if (jobId && !result) await run(() => api.cancelCalibration(jobId));
    onClose();
  }

  const title = `Calibrate: ${exercise?.name ?? exerciseId}`;

  if (status === 'offline') {
    return (
      <Card title={title} actions={<Button variant="ghost" size="sm" icon="close" onClick={onClose}>Close</Button>}>
        <Alert tone="warning" title="The hub is not reachable">Start the hub (and the camera client) on this network, then try again.</Alert>
      </Card>
    );
  }

  if (result) {
    return (
      <Card title={title} actions={<Button variant="secondary" size="sm" icon="check" onClick={onClose}>Done</Button>}>
        <Alert tone="success" title="Calibration saved">
          Built from {result.kept} reps on {result.slot.split('@')[1] ?? 'the camera'}. Scoring now compares this patient with their own good form.
        </Alert>
        {result.warnings.length > 0 ? (
          <Alert tone="warning" title="Worth a second look">
            <ul className="list-disc pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Alert>
        ) : null}
      </Card>
    );
  }

  if (!jobId) {
    return (
      <Card title={title} description="The camera will show the patient live and offer each detected rep for you to keep or redo." actions={<Button variant="ghost" size="sm" icon="close" onClick={onClose}>Close</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Camera"
            name="camera"
            value={cameraId}
            onChange={setCameraId}
            hint="Each camera keeps its own calibration, so pick the one the patient will exercise in front of."
            options={[{ value: '', label: 'Any camera (first to see the patient)' }, ...onlineCameras.map((c) => ({ value: c.id, label: c.id }))]}
          />
          <NumberField label="Good reps to collect" name="target" value={targetReps} onChange={(v) => setTargetReps(v ?? DEFAULT_REPS)} min={3} max={10} hint="At least 3 are needed; 5 is a good number." />
        </div>
        {onlineCameras.length === 0 ? <Alert tone="info">No camera is online yet. Start the camera client; it will appear here.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="mt-4"><Button onClick={() => void start()} loading={busy} icon="play">Start calibration</Button></div>
      </Card>
    );
  }

  return (
    <Card title={title} description={job ? progressText(job) : 'Starting…'} actions={<Button variant="ghost" size="sm" icon="close" onClick={() => void cancel()}>Cancel</Button>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Live view" className="space-y-2">
          <SkeletonCanvas landmarks={frame?.landmarks ?? null} aspect={frame?.aspect ?? 4 / 3} label="Live skeleton of the patient" />
          <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <Badge tone={HINT_TONE[hint.tone]}>{hint.tone === 'good' ? 'OK' : hint.tone === 'warn' ? 'Check' : 'Waiting'}</Badge>
            <span>{hint.text}</span>
            {frame?.angle != null ? <span className="text-slate-500">Angle {Math.round(frame.angle)}°</span> : null}
          </p>
        </section>

        <section aria-label="Captured reps" className="space-y-3">
          <RepList job={job} selected={selected} onSelect={setSelected} />
          {selected && detail.data ? (
            <div className="space-y-3">
              <ReplayPlayer frames={detail.data.frames} aspect={frame?.aspect ?? 4 / 3} />
              {detail.data.partial_return ? <Alert tone="warning">The patient did not fully return to the start. Consider redoing this rep.</Alert> : null}
              <div className="flex gap-2">
                <Button onClick={() => void decide(selected, 'kept')} loading={busy} icon="check" aria-label={`Keep rep ${selected}`}>Keep (good rep)</Button>
                <Button variant="danger" onClick={() => void decide(selected, 'discarded')} loading={busy} icon="redo" aria-label={`Redo rep ${selected}`}>Redo (bad rep)</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">{repCount === 0 ? 'No rep detected yet. Ask the patient to start.' : 'Select a rep to replay it.'}</p>
          )}
        </section>
      </div>
      {error ? <div className="mt-3"><Alert tone="error">{error}</Alert></div> : null}
      {job?.status === 'cancelled' ? <div className="mt-3"><Alert tone="warning">{job.message ?? 'Cancelled'}</Alert></div> : null}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void finish()} disabled={!canFinish(job)} loading={busy} icon="finished">Finish calibration</Button>
        {job && job.kept < job.min_kept ? <span className="text-sm text-slate-600">Keep {job.min_kept - job.kept} more good rep{job.min_kept - job.kept === 1 ? '' : 's'} to finish.</span> : null}
      </div>
    </Card>
  );
}

function RepList({ job, selected, onSelect }: { job: CalibrationJob | null; selected: number | null; onSelect: (index: number) => void }) {
  if (!job || job.reps.length === 0) return null;
  const tone = { pending: 'amber', kept: 'green', discarded: 'red' } as const;
  const label = { pending: 'To review', kept: 'Kept', discarded: 'Redo' } as const;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Detected reps">
      {job.reps.map((r) => (
        <li key={r.index}>
          <button
            type="button"
            onClick={() => onSelect(r.index)}
            aria-pressed={selected === r.index}
            className={`rounded-lg border px-3 py-1.5 text-sm ${selected === r.index ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-500/20' : 'border-slate-300 bg-white hover:border-slate-400'}`}
          >
            Rep {r.index} <Badge tone={tone[r.status]}>{label[r.status]}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}
