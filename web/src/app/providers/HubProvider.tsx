import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { env } from '../../config/env';
import { HubApi, HubError } from '../../services/hub/HubApi';
import { loadHubSettings, saveHubSettings } from '../settingsStorage';
import type { HubSettings } from '../settingsStorage';

export type HubStatus = 'checking' | 'online' | 'offline' | 'unauthorized';

interface HubContextValue {
  api: HubApi;
  status: HubStatus;
  settings: HubSettings;
  updateSettings: (next: HubSettings) => void;
  refresh: () => Promise<HubStatus>;
}

const HubContext = createContext<HubContextValue | null>(null);

/** The hub client, its connection status and the saved hub settings. */
export function useHub(): HubContextValue {
  const value = useContext(HubContext);
  if (!value) throw new Error('useHub must be used inside <HubProvider>');
  return value;
}

const POLL_MS = 10_000;

/** Holds the hub client and checks the hub every few seconds, so the whole app can show whether it is reachable. */
export function HubProvider({ children, pollMs = POLL_MS }: { children: ReactNode; pollMs?: number }) {
  const [settings, setSettings] = useState<HubSettings>(() => loadHubSettings());
  const [status, setStatus] = useState<HubStatus>('checking');
  // The key is read through a ref, so changing it does not create a new client
  const keyRef = useRef(settings.apiKey);
  keyRef.current = settings.apiKey;

  const api = useMemo(
    () => new HubApi({ baseUrl: settings.baseUrl || env.hubUrl, apiKey: () => keyRef.current || null }),
    [settings.baseUrl],
  );

  const refresh = useCallback(async (): Promise<HubStatus> => {
    let next: HubStatus;
    try {
      await api.getState();
      next = 'online';
    } catch (e) {
      next = e instanceof HubError && e.status === 401 ? 'unauthorized' : 'offline';
    }
    setStatus(next);
    return next;
  }, [api]);

  useEffect(() => {
    setStatus('checking');
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, settings.apiKey]);

  const updateSettings = useCallback((next: HubSettings) => {
    saveHubSettings(next);
    setSettings(next);
  }, []);

  const value = useMemo(() => ({ api, status, settings, updateSettings, refresh }), [api, status, settings, updateSettings, refresh]);
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}
