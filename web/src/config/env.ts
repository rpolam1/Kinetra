/** Build time settings. Vite replaces the VITE_ variables when the app is built. */
type EnvBag = Readonly<Record<string, string | undefined>>;

// The cast lets this file load under tests, where import.meta.env may not exist
const raw: EnvBag = (import.meta as unknown as { env?: EnvBag }).env ?? {};

export type DataBackend = 'memory' | 'firebase';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** The app's settings. The memory backend is used unless Firebase is chosen, so local development works without an account. */
export const env = {
  baseUrl: raw.BASE_URL ?? '/',
  dataBackend: (raw.VITE_DATA_BACKEND === 'firebase' ? 'firebase' : 'memory') as DataBackend,
  // A trailing slash is removed so paths can be added directly
  hubUrl: (raw.VITE_HUB_URL ?? '').replace(/\/+$/, ''),
  firebase: {
    apiKey: raw.VITE_FIREBASE_API_KEY ?? '',
    authDomain: raw.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: raw.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: raw.VITE_FIREBASE_APP_ID ?? '',
  },
} as const;

/** Return the Firebase settings, or throw with the names of the variables that are empty. */
export function requireFirebaseConfig(config: FirebaseConfig = env.firebase): FirebaseConfig {
  const missing = (Object.entries(config) as [keyof FirebaseConfig, string][])
    .filter(([, value]) => !value)
    .map(([key]) => `VITE_FIREBASE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`Firebase is selected but these variables are empty: ${missing.join(', ')}`);
  }
  return config;
}
