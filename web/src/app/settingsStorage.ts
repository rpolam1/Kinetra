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

/** The browser's local storage, or null when it is blocked or missing. */
export function browserStorage(): SettingsStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

/** Read the hub address and API key. Missing values are empty strings. */
export function loadHubSettings(storage: SettingsStorage | null = browserStorage()): HubSettings {
  return {
    baseUrl: storage?.getItem(URL_KEY) ?? '',
    apiKey: storage?.getItem(API_KEY_KEY) ?? '',
  };
}

/** Save the hub address and API key. An empty value removes the saved one. */
export function saveHubSettings(settings: HubSettings, storage: SettingsStorage | null = browserStorage()): void {
  if (!storage) return;
  const write = (key: string, value: string) => (value ? storage.setItem(key, value) : storage.removeItem(key));
  write(URL_KEY, settings.baseUrl.trim().replace(/\/+$/, ''));
  write(API_KEY_KEY, settings.apiKey.trim());
}
