import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from './app/AppShell';
import { ErrorBoundary } from './app/ErrorBoundary';
import { Redirect, Router, useCurrentPath } from './app/router';
import type { RouteDef } from './app/router';
import { AccountsProvider } from './app/providers/AccountsProvider';
import { AuthProvider, useAuth } from './app/providers/AuthProvider';
import { DataProvider } from './app/providers/DataProvider';
import { HubProvider } from './app/providers/HubProvider';
import { ToastProvider } from './app/providers/ToastProvider';
import type { DataLayer } from './data/repositories';
import { AccountPage } from './features/auth/AccountPage';
import { AccountStatusScreen } from './features/auth/AccountStatusScreen';
import { AuthScreen } from './features/auth/AuthScreen';
import { TeamPage } from './features/admin/TeamPage';
import { NewPatientPage } from './features/patients/NewPatientPage';
import { PatientProfilePage } from './features/patients/PatientProfilePage';
import { PatientsPage } from './features/patients/PatientsPage';
import { BoardPage } from './features/session/BoardPage';
import { SessionPage } from './features/session/SessionPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { Alert, Spinner } from './ui/display';
import { installHoverMotion } from './ui/motion/hover';

const inShell = (page: ReactNode) => <AppShell>{page}</AppShell>;

export const ROUTES: readonly RouteDef[] = [
  { pattern: '/', render: () => <Redirect to="/patients" /> },
  { pattern: '/patients', render: () => inShell(<PatientsPage />) },
  { pattern: '/patients/new', render: () => inShell(<NewPatientPage />) },
  { pattern: '/patients/:id/:tab?', render: ({ id, tab }) => inShell(<PatientProfilePage patientId={id!} tab={tab} />) },
  { pattern: '/session', render: () => inShell(<SessionPage />) },
  { pattern: '/settings', render: () => inShell(<SettingsPage />) },
  { pattern: '/account', render: () => inShell(<AccountPage />) },
  { pattern: '/admin/users', render: () => inShell(<TeamPage />) },
  { pattern: '/board', render: () => <BoardPage /> },
];

const PUBLIC_PATHS: readonly string[] = ['/board'];

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const path = useCurrentPath();
  if (PUBLIC_PATHS.includes(path)) return <>{children}</>;
  if (loading) return <Spinner />;
  if (!user) return <AuthScreen />;
  if (user.status !== 'approved' || !user.role) return <AccountStatusScreen />;
  return <AccountsProvider>{children}</AccountsProvider>;
}

export function App({ createLayer }: { createLayer?: () => Promise<DataLayer> }) {
  useEffect(() => installHoverMotion(), []);
  return (
    <ErrorBoundary>
      <ToastProvider>
        <DataProvider createLayer={createLayer}>
          <AuthProvider>
            <HubProvider>
              <AuthGate>
                <Router routes={ROUTES} notFound={inShell(<Alert tone="warning" title="Page not found" />)} />
              </AuthGate>
            </HubProvider>
          </AuthProvider>
        </DataProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
