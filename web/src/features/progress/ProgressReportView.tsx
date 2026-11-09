import { useMemo } from 'react';
import { buildProgressReport, formatPercent } from '../../domain';
import type { Patient, PatientSession } from '../../domain';
import { Badge, Card, EmptyState } from '../../ui/display';
import { Button } from '../../ui/Button';
import { changeTone, describeChange, metricsFor } from './format';
import { printProgressReport } from './printReport';
import { TrendChart } from './TrendChart';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function ProgressReportView({ patient, sessions }: { patient: Patient; sessions: readonly PatientSession[] }) {
  const report = useMemo(() => buildProgressReport(sessions), [sessions]);

  if (report.sessionCount === 0) {
    return (
      <Card title="Progress report" description="Range of motion, good-rep rate and tempo over the weeks.">
        <EmptyState title="Nothing to report yet">Progress appears here after this patient finishes a tracked session.</EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card
        title="Progress report"
        description={`${report.sessionCount} session${report.sessionCount === 1 ? '' : 's'} so far. Weeks start on Monday.`}
        actions={<Button onClick={() => printProgressReport(patient, report)} icon="print">Save as PDF</Button>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Sessions" value={String(report.sessionCount)} />
          <Stat label="Reps counted" value={String(report.totalReps)} />
          <Stat label="Good-rep rate" value={formatPercent(report.goodRate)} />
          <Stat label="Average form" value={report.avgScore !== null ? `${Math.round(report.avgScore)} / 100` : '—'} />
        </div>
        <p className="mt-3 text-sm text-slate-600">The report opens in your browser's print window. Choose Save as PDF as the destination.</p>
      </Card>

      {report.heart ? (
        <Card
          title="Heart rate"
          description={`${report.heart.sessions} session${report.heart.sessions === 1 ? '' : 's'} with a watch${report.heart.zoneLow !== null && report.heart.zoneHigh !== null ? `. Target zone ${report.heart.zoneLow} to ${report.heart.zoneHigh} bpm` : ''}`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Average" value={report.heart.avgBpm !== null ? `${Math.round(report.heart.avgBpm)} bpm` : '—'} />
            <Stat label="Highest" value={report.heart.peakBpm !== null ? `${Math.round(report.heart.peakBpm)} bpm` : '—'} />
            <Stat label="In target zone" value={formatPercent(report.heart.inZoneRate)} />
            <Stat label="Above zone" value={formatPercent(report.heart.aboveRate)} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <TrendChart title="Average heart rate (bpm)" weeks={report.heart.weeks} pick={(w) => w.avgBpm} format={(v) => `${Math.round(v)}`} color="#be123c" />
            <TrendChart title="Time in target zone" weeks={report.heart.weeks} pick={(w) => w.inZoneRate} format={(v) => `${Math.round(v * 100)}%`} min={0} max={1} />
          </div>
        </Card>
      ) : null}

      {report.exercises.map((ex) => (
        <Card
          key={ex.exerciseId}
          title={ex.name}
          description={`${ex.sessions} session${ex.sessions === 1 ? '' : 's'}, ${ex.timed ? `${ex.holdsCompleted} of ${ex.holdAttempts} holds completed` : `${ex.reps} reps`}`}
          actions={ex.readyToProgress ? <Badge tone="green" icon="check">Ready to progress</Badge> : undefined}
        >
          <div className="grid gap-3 lg:grid-cols-3">
            {metricsFor(ex).map((m) => (
              <TrendChart key={m.key} title={m.title} weeks={ex.weeks} pick={m.pick} format={m.format} min={m.min} max={m.max} />
            ))}
          </div>
          {ex.change ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${ex.name} change since first week`}>
              {metricsFor(ex).map((m) => (
                <li key={m.key}>
                  <Badge tone={changeTone(m, ex.change![m.key])}>{m.title.split(' (')[0]}: {describeChange(m, ex.change![m.key])}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Changes show once there are at least two weeks of data.</p>
          )}
          {ex.readyToProgress ? (
            <p className="mt-2 text-sm text-slate-700">Last two sessions had {ex.goodRepsLastTwo.join(' and ')} good reps. Consider increasing the load or difficulty.</p>
          ) : null}
        </Card>
      ))}

    </div>
  );
}
