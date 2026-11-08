import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_TAG_ID } from '../../../domain';
import type { Patient } from '../../../domain';
import { useAsync } from '../../../app/hooks/useAsync';
import { useTagSync } from '../../../app/hooks/useTagSync';
import { useAuth } from '../../../app/providers/AuthProvider';
import { useData } from '../../../app/providers/DataProvider';
import { useHub } from '../../../app/providers/HubProvider';
import { useToast } from '../../../app/providers/ToastProvider';
import { Button } from '../../../ui/Button';
import { Alert, Badge, Card, Spinner } from '../../../ui/display';
import { NumberField } from '../../../ui/fields';

function nameSize(name: string, base: number): number {
  const factor = name.length <= 10 ? 1 : name.length <= 14 ? 0.82 : name.length <= 19 ? 0.64 : 0.5;
  return Math.round(base * factor * 100) / 100;
}

export function TagTab({ patient, onChanged }: { patient: Patient; onChanged: () => void }) {
  const { patients } = useData();
  const { api, status } = useHub();
  const { can } = useAuth();
  const toast = useToast();
  const syncTags = useTagSync();
  const [imageFailed, setImageFailed] = useState(false);
  const [newTag, setNewTag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const tagId = patient.tagId;
  const onHub = useAsync(async () => (tagId === null ? null : ((await api.getTags())[String(tagId)] ?? null)), [api, tagId, status]);

  if (tagId === null) {
    return <Alert tone="info" title="No tag">Archived patients do not wear a tag.</Alert>;
  }

  const registered = onHub.data?.patient_id === patient.code && onHub.data?.display_name === patient.boardName;

  const sendToHub = async () => {
    setBusy(true);
    await syncTags({});
    onHub.reload();
    setBusy(false);
  };

  const reassign = async () => {
    if (newTag === null) return;
    setBusy(true);
    try {
      await patients.reassignTag(patient.id, newTag);
      await syncTags({ quiet: true });
      toast.success(`Tag changed to #${newTag}. Print the new tag.`);
      setNewTag(null);
      setImageFailed(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the tag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Printable tag" description="Prints one big tag on a full page, with their name under it. Cut along the dashed line and pin it to the chest or back.">
        {imageFailed ? (
          <Alert tone="warning" title="Could not load the tag image">Start the hub (it draws the tag) and check Settings.</Alert>
        ) : (
          <div className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-5 text-center shadow-card">
            <div className="rounded-lg border border-dashed border-slate-300 p-4">
              <img src={api.tagImageUrl(tagId, 700)} alt={`AprilTag number ${tagId}`} width={700} height={700} onError={() => setImageFailed(true)} className="mx-auto h-auto w-full" style={{ imageRendering: 'pixelated' }} />
            </div>
            <p className="mt-4 font-semibold leading-tight text-slate-900" style={{ fontSize: nameSize(patient.boardName, 2.25) + 'rem' }}>{patient.boardName}</p>
            <p className="mt-1 text-sm text-slate-500">{patient.code} · Tag #{tagId}</p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => window.print()} disabled={imageFailed} icon="print">Print tag</Button>
          <span className="text-sm text-slate-500">About 17 cm wide on Letter or A4. Use matte paper.</span>
        </div>
        {!imageFailed
          ? createPortal(
              <div className="print-root" aria-hidden="true">
                <div className="print-frame">
                  <img src={api.tagImageUrl(tagId, 1600)} alt="" className="print-tag" />
                </div>
                <p className="print-name" style={{ fontSize: nameSize(patient.boardName, 66) + 'pt' }}>{patient.boardName}</p>
                <p className="print-code">{patient.code} · Tag #{tagId}</p>
              </div>,
              document.body,
            )
          : null}
      </Card>

      <div className="space-y-6">
        <Card title="Camera registration" description="The cameras learn who wears which tag from the hub.">
          {onHub.loading && onHub.data === null ? (
            <Spinner />
          ) : status !== 'online' ? (
            <Alert tone="warning" title="Hub not reachable">Tags are saved in the cloud and sent automatically when the hub is back.</Alert>
          ) : registered ? (
            <p className="flex items-center gap-2 text-sm"><Badge tone="green">Registered</Badge> The cameras will recognise this tag as {patient.code}.</p>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm"><Badge tone="amber">Not on the hub yet</Badge></p>
              <Button onClick={sendToHub} loading={busy} icon="refresh">Send to hub now</Button>
            </div>
          )}
        </Card>

        {can('tag:manage') && patient.status === 'active' ? (
          <Card title="Change tag number" description="Only needed if a printed tag is lost or damaged and you want a different number.">
            <div className="flex items-end gap-3">
              <div className="w-32">
                <NumberField label="New tag number" name="newTag" min={0} max={MAX_TAG_ID} value={newTag} onChange={setNewTag} />
              </div>
              <Button variant="secondary" onClick={reassign} loading={busy} disabled={newTag === null} icon="tag">Change tag</Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
