type EnvBag = Readonly<Record<string, string | undefined>>;

const raw: EnvBag = (import.meta as unknown as { env?: EnvBag }).env ?? {};

export type DataBackend = 'memory' | 'firebase';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export const env = {
  baseUrl: raw.BASE_URL ?? '/',
  dataBackend: (raw.VITE_DATA_BACKEND === 'firebase' ? 'firebase' : 'memory') as DataBackend,
  hubUrl: (raw.VITE_HUB_URL ?? '').replace(/\/+$/, ''),
  firebase: {
    apiKey: raw.VITE_FIREBASE_API_KEY ?? '',
    authDomain: raw.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: raw.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: raw.VITE_FIREBASE_APP_ID ?? '',
  },
} as const;

export function requireFirebaseConfig(config: FirebaseConfig = env.firebase): FirebaseConfig {
  const missing = (Object.entries(config) as [keyof FirebaseConfig, string][])
    .filter(([, value]) => !value)
    .map(([key]) => `VITE_FIREBASE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`Firebase is selected but these variables are empty: ${missing.join(', ')}`);
  }
  return config;
}
