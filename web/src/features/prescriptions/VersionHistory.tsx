import { describeDiff, diffContent } from '../../domain';
import type { Prescription } from '../../domain';
import { Button } from '../../ui/Button';
import { Badge, Card } from '../../ui/display';

interface VersionHistoryProps {
  history: readonly Prescription[];
  canRestore: boolean;
  onRestore: (version: Prescription) => void;
}

export function VersionHistory({ history, canRestore, onRestore }: VersionHistoryProps) {
  return (
    <Card title="Version history" description="Every change is kept. Restoring copies an old version into the editor; saving makes a new version.">
      {history.length === 0 ? (
        <p className="text-sm text-slate-600">No versions yet.</p>
      ) : (
        <ol className="space-y-3" aria-label="Prescription versions">
          {history.map((v, i) => {
            const older = history[i + 1] ?? null;
            return (
              <li key={v.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>Version {v.version}</strong>
                  {v.status === 'current' ? <Badge tone="green">Current</Badge> : null}
                  <span className="text-xs text-slate-500">{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-700">{v.reason}</p>
                <p className="text-xs text-slate-500">{older ? describeDiff(diffContent(older, v)) : `${v.exercises.length} exercises`}</p>
                {canRestore && v.status !== 'current' ? (
                  <Button size="sm" variant="secondary" icon="history" onClick={() => onRestore(v)}>Restore version {v.version}</Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
