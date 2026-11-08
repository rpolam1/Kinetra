export interface HubSettings {
  baseUrl: string;
  apiKey: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const URL_KEY = 'exercise-tracker.hub-url';
const API_KEY_KEY = 'exercise-tracker.hub-api-key';

export function browserStorage(): SettingsStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

export function loadHubSettings(storage: SettingsStorage | null = browserStorage()): HubSettings {
  return {
    baseUrl: storage?.getItem(URL_KEY) ?? '',
    apiKey: storage?.getItem(API_KEY_KEY) ?? '',
  };
}

export function saveHubSettings(settings: HubSettings, storage: SettingsStorage | null = browserStorage()): void {
  if (!storage) return;
  const write = (key: string, value: string) => (value ? storage.setItem(key, value) : storage.removeItem(key));
  write(URL_KEY, settings.baseUrl.trim().replace(/\/+$/, ''));
  write(API_KEY_KEY, settings.apiKey.trim());
}
