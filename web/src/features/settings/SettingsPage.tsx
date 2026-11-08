import { useState } from 'react';
import { env } from '../../config/env';
import { useTagSync } from '../../app/hooks/useTagSync';
import { useAuth } from '../../app/providers/AuthProvider';
import { useData } from '../../app/providers/DataProvider';
import { useHub } from '../../app/providers/HubProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { Button } from '../../ui/Button';
import { Alert, Badge, Card, DefinitionList, PageHeader } from '../../ui/display';
import { TextField } from '../../ui/fields';

export function SettingsPage() {
  const { settings, updateSettings, status, refresh } = useHub();
  const { mode } = useData();
  const { can } = useAuth();
  const toast = useToast();
  const syncTags = useTagSync();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [busy, setBusy] = useState(false);

  const editable = can('hub:configure');

  const save = async () => {
    updateSettings({ baseUrl, apiKey });
    toast.success('Hub settings saved.');
  };

  const test = async () => {
    setBusy(true);
    updateSettings({ baseUrl, apiKey });
    const result = await refresh();
    setBusy(false);
    if (result === 'online') toast.success('Connected to the hub.');
    else if (result === 'unauthorized') toast.error('The hub needs an API key.');
    else toast.error('Cannot reach the hub at that address.');
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Setup" title="Settings" description="How this browser finds the hub, and a few things about this install." />

      <Card title="Hub connection" description="The hub is the program running next to the cameras. Leave the address empty when the hub serves this page.">
        <div className="space-y-4">
          <TextField label="Hub address" name="hubUrl" value={baseUrl} disabled={!editable} autoComplete="url" placeholder="same as this page" hint="e.g. http://192.168.1.23:5000, only needed when this page is NOT served by the hub" onChange={setBaseUrl} />
          <TextField label="Hub API key" name="hubKey" type="password" value={apiKey} disabled={!editable} autoComplete="new-password" hint="Only if the hub was started with HUB_API_KEY. Stored in this browser only, never in the code." onChange={setApiKey} />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={!editable} icon="save">Save</Button>
            <Button variant="secondary" onClick={test} loading={busy} disabled={!editable} icon="online">Test connection</Button>
            <span className="text-sm text-slate-600">Status: <Badge tone={status === 'online' ? 'green' : status === 'checking' ? 'slate' : 'red'}>{status}</Badge></span>
          </div>
        </div>
      </Card>

      <Card title="Tags" description="The cloud decides who wears which tag; the hub keeps a copy for the cameras.">
        <Button variant="secondary" icon="refresh" disabled={!editable || status !== 'online'} onClick={() => void syncTags({})}>Re-sync all tags to the hub</Button>
        {status !== 'online' ? <p className="mt-2 text-sm text-slate-600">Connect to the hub first.</p> : null}
      </Card>

      <Card title="About this install">
        <DefinitionList
          items={[
            { term: 'Data backend', detail: mode === 'firebase' ? 'Firebase (cloud)' : 'Demo (this browser only)' },
            { term: 'Hub address', detail: settings.baseUrl || env.hubUrl || 'same origin as this page' },
          ]}
        />
        {mode === 'memory' ? <div className="mt-4"><Alert tone="warning" title="Demo data is not saved to the cloud">Set VITE_DATA_BACKEND=firebase and the Firebase variables (see .env.example) to use real storage.</Alert></div> : null}
      </Card>
    </div>
  );
}
