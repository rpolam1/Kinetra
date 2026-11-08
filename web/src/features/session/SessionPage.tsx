import { useState } from 'react';
import { sessionsFromSummary } from '../../domain';
import type { PatientSession } from '../../domain';
import { useLiveSnapshot } from '../../app/hooks/useHubStream';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { useHub } from '../../app/providers/HubProvider';
import { useToast } from '../../app/providers/ToastProvider';
import type { SessionParticipantInput, SessionSummary } from '../../services/hub/types';
import { Button } from '../../ui/Button';
import { CheckboxField } from '../../ui/fields';
import { Alert, Badge, Card, PageHeader } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { AnimatedNumber } from '../../ui/motion/AnimatedNumber';
import { buttonClass } from '../../ui/Button';
import { ParticipantCard } from './ParticipantCard';
import { SessionSetup } from './SessionSetup';
import { StatusLight } from './StatusLight';
import { countByLight, sortByNeed } from './roster';
import type { Light } from '../../services/hub/types';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function SessionPage() {
  const { api, status } = useHub();
  const { patients, sessions } = useData();
  const { user, can } = useAuth();
  const toast = useToast();
  const { snapshot, state } = useLiveSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<SessionSummary | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const active = snapshot?.session?.active === true;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const start = (participants: SessionParticipantInput[], autoAdvance: boolean) =>
    run(async () => {
      setSaved(null);
      await api.startSession(participants, autoAdvance);
    });

  async function save(summary: SessionSummary): Promise<void> {
    if (!user) return;
    const codes = summary.participants.map((p) => p.patient_id);
    const idByCode: Record<string, string> = {};
    await Promise.all(
      codes.map(async (code) => {
        const match = (await patients.search(code, 1))[0];
        if (match && match.code === code) idByCode[code] = match.id;
      }),
    );
    const records: PatientSession[] = sessionsFromSummary(summary, idByCode, user.uid);
    await Promise.all(records.map((r) => sessions.save(r)));
    setPendingSave(null);
    setSaved(records.length);
    toast.success(`Saved the session for ${records.length} ${records.length === 1 ? 'person' : 'people'}`);
  }

  const end = () =>
    run(async () => {
      const summary = await api.endSession();
      setPendingSave(summary);
      await save(summary);
    });

  const retrySave = () => run(async () => {
    if (pendingSave) await save(pendingSave);
  });

  if (!can('session:run')) return <Alert tone="warning" title="Your role cannot run sessions" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live"
        title="Live session"
        description={active ? 'Everyone in the room, most urgent first. Lights update as cameras see each rep.' : 'Choose who is exercising, then start. The board for the TV follows along.'}
        actions={
          <a href="#/board" target="_blank" rel="noreferrer" data-hover="button" className={buttonClass('secondary', 'md')}>
            <Icon name="board" /> Open the board for the TV
          </a>
        }
      />

      {status === 'offline' ? <Alert tone="warning" title="The hub is not reachable">Start the hub on this network. Settings shows the address it is looking for.</Alert> : null}
      {status === 'unauthorized' ? <Alert tone="warning" title="The hub needs an API key">Enter it in Settings.</Alert> : null}
      {state === 'reconnecting' && status === 'online' ? <Alert tone="info">Live updates are reconnecting…</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {pendingSave ? (
        <Alert tone="warning" title="The session ended but could not be saved to the cloud">
          <p>The results are kept here until they are saved. Check the internet connection, then retry.</p>
          <div className="mt-2"><Button onClick={() => void retrySave()} loading={busy} icon="refresh">Retry saving</Button></div>
        </Alert>
      ) : null}
      {saved !== null && !active ? <Alert tone="success" title="Session saved">Results were added to {saved} patient {saved === 1 ? 'record' : 'records'}.</Alert> : null}

      {active && snapshot ? (
        <Monitor
          snapshot={snapshot}
          busy={busy}
          onNext={(id) => void run(() => api.advance(id))}
          onAuto={(enabled) => void run(() => api.setAutoAdvance(enabled))}
          onEnd={() => { if (window.confirm('End the session for everyone and save the results?')) void end(); }}
        />
      ) : (
        <SessionSetup onStart={(p, a) => void start(p, a)} starting={busy} />
      )}
    </div>
  );
}

function Monitor({ snapshot, busy, onNext, onAuto, onEnd }: { snapshot: NonNullable<ReturnType<typeof useLiveSnapshot>['snapshot']>; busy: boolean; onNext: (id: string) => void; onAuto: (enabled: boolean) => void; onEnd: () => void }) {
  const people = sortByNeed(snapshot.participants);
  const counts = countByLight(snapshot.participants);
  const lights: Light[] = ['needs_help', 'drifting', 'not_detected', 'resting', 'on_track', 'finished'];
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ul className="flex flex-wrap gap-2" aria-label="Summary">
            {lights.filter((l) => counts[l] > 0).map((l) => (
              <li key={l} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-3">
                <StatusLight light={l} />
                <AnimatedNumber value={counts[l]} className="text-base font-bold tabular-nums text-slate-900" />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <CheckboxField label="Auto-advance" name="auto" checked={snapshot.session?.auto_advance ?? false} onChange={onAuto} />
            <Button variant="danger" icon="finished" onClick={onEnd} disabled={busy}>End session</Button>
          </div>
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <Icon name="camera" /> Cameras:
          {snapshot.cameras.length === 0 ? ' none seen yet' : snapshot.cameras.map((c) => <Badge key={c.id} tone={c.online ? 'green' : 'slate'} icon="online">{`${c.id} ${c.online ? 'online' : 'offline'}`}</Badge>)}
          {snapshot.unidentified.length > 0 ? <Badge tone="amber" icon="warning">{`${snapshot.unidentified.length} unidentified ${snapshot.unidentified.length === 1 ? 'person' : 'people'} in view`}</Badge> : null}
        </p>
      </Card>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Participants">
        {people.map((p) => <ParticipantCard key={p.patient_id} person={p} onNext={onNext} busy={busy} />)}
      </ul>
    </>
  );
}
