import { exerciseTrend, exercisesSeen } from '../../domain';
import type { PatientSession } from '../../domain';
import { useAsync } from '../../app/hooks/useAsync';
import { useData } from '../../app/providers/DataProvider';
import { Alert, Card, EmptyState, Spinner } from '../../ui/display';
import { Sparkline } from './Sparkline';

const SHOWN = 30;

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SessionHistory({ patientId }: { patientId: string }) {
  const { sessions } = useData();
  const history = useAsync(() => sessions.forPatient(patientId, SHOWN), [sessions, patientId]);

  if (history.loading && history.data === null) return <Spinner />;
  if (history.error) return <Alert tone="error" title="Could not load sessions">{history.error.message}</Alert>;
  const list: PatientSession[] = history.data ?? [];
  if (list.length === 0) {
    return (
      <Card title="Sessions and trends" description="Form scores per exercise, good-rep counts and progress over time.">
        <EmptyState title="No sessions recorded yet">Once this patient exercises in a tracked session, it will appear here.</EmptyState>
      </Card>
    );
  }
  const trends = exercisesSeen(list).slice(0, 8);
  return (
    <>
      <Card title="Trends" description={`Average form score per session, last ${list.length} session${list.length === 1 ? '' : 's'}.`}>
        <ul className="divide-y divide-slate-100" aria-label="Exercise trends">
          {trends.map(({ exerciseId, name }) => {
            const points = exerciseTrend(list, exerciseId);
            const latest = points[points.length - 1];
            return (
              <li key={exerciseId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="font-medium">{name}</span>
                <span className="flex items-center gap-4">
                  <Sparkline values={points.map((p) => p.avgScore)} label={`${name} form score over time`} />
                  <span className="w-28 text-right text-sm text-slate-700">
                    {latest?.avgScore != null ? `${Math.round(latest.avgScore)} / 100` : `${latest?.reps ?? 0} reps`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Past sessions">
        <ul className="divide-y divide-slate-100" aria-label="Past sessions">
          {list.map((s) => {
            const done = s.exercises.filter((e) => e.reps > 0 || e.completed);
            return (
              <li key={s.id} className="py-3">
                <p className="font-medium">{when(s.startedAt)} <span className="font-normal text-slate-500">· {Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000))} min</span></p>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {done.map((e) => (
                    <li key={e.exerciseId}>
                      {e.name}: {e.reps} reps{e.targetReps ? ` of ${e.targetSets * e.targetReps}` : ''}
                      {e.avgScore !== null ? `, form ${Math.round(e.avgScore)}` : ''}
                      {e.flagged > 0 ? `, ${e.flagged} flagged` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
