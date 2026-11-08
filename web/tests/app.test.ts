import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchRoute } from '../src/app/router';
import { ROUTES } from '../src/App';
import { loadHubSettings, saveHubSettings } from '../src/app/settingsStorage';
import type { SettingsStorage } from '../src/app/settingsStorage';

function fakeStorage(): SettingsStorage & { bag: Map<string, string> } {
  const bag = new Map<string, string>();
  return {
    bag,
    getItem: (k) => bag.get(k) ?? null,
    setItem: (k, v) => void bag.set(k, v),
    removeItem: (k) => void bag.delete(k),
  };
}

describe('router matching', () => {
  it('matches static and parameter routes', () => {
    assert.deepEqual(matchRoute('/patients', '/patients'), {});
    assert.deepEqual(matchRoute('/patients/:id', '/patients/abc'), { id: 'abc' });
    assert.equal(matchRoute('/patients', '/patients/abc'), null);
    assert.equal(matchRoute('/patients/:id', '/patients'), null);
    assert.equal(matchRoute('/session', '/settings'), null);
  });
  it('supports an optional trailing parameter', () => {
    assert.deepEqual(matchRoute('/patients/:id/:tab?', '/patients/abc'), { id: 'abc' });
    assert.deepEqual(matchRoute('/patients/:id/:tab?', '/patients/abc/tag'), { id: 'abc', tab: 'tag' });
    assert.equal(matchRoute('/patients/:id/:tab?', '/patients/abc/tag/extra'), null);
  });
  it('ignores slashes at the ends and decodes values', () => {
    assert.deepEqual(matchRoute('/patients/:id', 'patients/a%20b/'), { id: 'a b' });
    assert.deepEqual(matchRoute('/', '/'), {});
  });
  it('resolves /patients/new before the :id route', () => {
    const first = ROUTES.find((r) => matchRoute(r.pattern, '/patients/new') !== null);
    assert.equal(first?.pattern, '/patients/new');
    const profile = ROUTES.find((r) => matchRoute(r.pattern, '/patients/pat_1/tag') !== null);
    assert.equal(profile?.pattern, '/patients/:id/:tab?');
  });
});

describe('hub settings storage', () => {
  it('round-trips and trims, removing empty values', () => {
    const s = fakeStorage();
    saveHubSettings({ baseUrl: ' http://10.0.0.5:5000/ ', apiKey: ' k ' }, s);
    assert.deepEqual(loadHubSettings(s), { baseUrl: 'http://10.0.0.5:5000', apiKey: 'k' });
    saveHubSettings({ baseUrl: '', apiKey: '' }, s);
    assert.equal(s.bag.size, 0);
    assert.deepEqual(loadHubSettings(s), { baseUrl: '', apiKey: '' });
  });
  it('works when storage is unavailable', () => {
    assert.deepEqual(loadHubSettings(null), { baseUrl: '', apiKey: '' });
    assert.doesNotThrow(() => saveHubSettings({ baseUrl: 'x', apiKey: 'y' }, null));
  });
});
