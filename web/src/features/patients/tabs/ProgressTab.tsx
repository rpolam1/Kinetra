import type { Patient } from '../../../domain';
import { useAsync } from '../../../app/hooks/useAsync';
import { useData } from '../../../app/providers/DataProvider';
import { Alert, Spinner } from '../../../ui/display';
import { ProgressReportView } from '../../progress/ProgressReportView';

const MAX_SESSIONS = 200;

export function ProgressTab({ patient }: { patient: Patient }) {
  const { sessions } = useData();
  const history = useAsync(() => sessions.forPatient(patient.id, MAX_SESSIONS), [sessions, patient.id]);

  if (history.loading && history.data === null) return <Spinner />;
  if (history.error) return <Alert tone="error" title="Could not load sessions">{history.error.message}</Alert>;
  return <ProgressReportView patient={patient} sessions={history.data ?? []} />;
}
