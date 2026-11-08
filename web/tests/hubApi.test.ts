import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HubApi, HubError } from '../src/services/hub/HubApi';
import { hubMatchesRegistry, syncRegistryToHub } from '../src/services/hub/tagSync';
import type { TagRegistry } from '../src/domain';

const VISION_DIR = resolve(import.meta.dirname, '..', '..', 'vision');
const PYTHON = process.env.PYTHON ?? 'python3';

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => ok(port));
    });
    srv.on('error', fail);
  });
}

async function startHub(apiKey?: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const db = join(mkdtempSync(join(tmpdir(), 'hub-')), 'hub.db');
  const child: ChildProcess = spawn(PYTHON, ['-m', 'server.hub', '--port', String(port), '--db', db, '--no-discovery'], {
    cwd: VISION_DIR,
    env: { ...process.env, ...(apiKey ? { HUB_API_KEY: apiKey } : { HUB_API_KEY: '' }) },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop: () => child.kill() };
    } catch {
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('hub did not start (is Python + Flask installed? set PYTHON=...)');
}

const REGISTRY: TagRegistry = {
  0: { patientId: 'pat_1', code: 'P-0001', boardName: 'Ana K.' },
  7: { patientId: 'pat_2', code: 'P-0002', boardName: 'Bo L.' },
};

describe('HubApi against the real hub', () => {
  let hub: { url: string; stop: () => void };
  before(async () => { hub = await startHub(); });
  after(() => hub.stop());

  it('reports health', async () => {
    const h = await new HubApi({ baseUrl: hub.url }).health();
    assert.equal(h.ok, true);
  });
  it('registers, lists and deletes a tag; state reflects it', async () => {
    const api = new HubApi({ baseUrl: hub.url });
    await api.setTag(12, 'P-0042', 'Ana K.');
    assert.deepEqual((await api.getTags())['12'], { patient_id: 'P-0042', display_name: 'Ana K.' });
    const state = await api.getState();
    assert.equal(state.tags_managed, true);
    assert.equal(state.tags['12']!.patient_id, 'P-0042');
    await api.deleteTag(12);
    assert.deepEqual(await api.getTags(), {});
    assert.equal((await api.getState()).tags_managed, false);
  });
  it('rejects an out-of-range tag with a readable error', async () => {
    await assert.rejects(new HubApi({ baseUrl: hub.url }).setTag(900, 'P-1', 'x'), (e: unknown) => e instanceof HubError && e.status === 400);
  });
  it('replaces all tags atomically and syncs only when something differs', async () => {
    const api = new HubApi({ baseUrl: hub.url });
    assert.equal(await syncRegistryToHub(api, REGISTRY), 2);
    assert.equal(hubMatchesRegistry(await api.getTags(), REGISTRY), true);
    assert.equal(await syncRegistryToHub(api, REGISTRY), null); // already in sync, no write
    const changed: TagRegistry = { ...REGISTRY, 7: { ...REGISTRY[7]!, boardName: 'Bo Z.' } };
    assert.equal(await syncRegistryToHub(api, changed), 2);
    assert.equal((await api.getTags())['7']!.display_name, 'Bo Z.');
    assert.equal(await syncRegistryToHub(api, {}), 0); // everyone archived, hub emptied
  });
  it('serves a printable tag image that is a real PNG', async () => {
    const api = new HubApi({ baseUrl: hub.url });
    const res = await fetch(api.tagImageUrl(5, 200));
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71]); // PNG signature
  });
  it('reports an unreachable hub as a HubError with no status', async () => {
    const dead = new HubApi({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 800 });
    await assert.rejects(dead.health(), (e: unknown) => e instanceof HubError && e.status === null);
  });
});

describe('HubApi with an API key', () => {
  let hub: { url: string; stop: () => void };
  before(async () => { hub = await startHub('s3cret'); });
  after(() => hub.stop());

  it('is refused without the key and works with it (key read at call time)', async () => {
    let key: string | null = null;
    const api = new HubApi({ baseUrl: hub.url, apiKey: () => key });
    await assert.rejects(api.getState(), (e: unknown) => e instanceof HubError && e.status === 401);
    key = 'wrong';
    await assert.rejects(api.getState(), (e: unknown) => e instanceof HubError && e.status === 401);
    key = 's3cret';
    assert.equal((await api.getState()).tags_managed, false);
  });
  it('still serves tag images and health without a key', async () => {
    const api = new HubApi({ baseUrl: hub.url });
    assert.equal((await api.health()).ok, true);
    assert.equal((await fetch(api.tagImageUrl(3))).status, 200);
  });
});
