import { computeAge, hasBetaBlocker } from '../../domain';
import { Link } from '../../app/router';
import { useAsync } from '../../app/hooks/useAsync';
import { useData } from '../../app/providers/DataProvider';
import { Alert, Avatar, Badge, Spinner } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { TabNav } from '../../ui/TabNav';
import { STREAM_LABELS } from './labels';
import { CalibrationTab } from './tabs/CalibrationTab';
import { DetailsTab } from './tabs/DetailsTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PrescriptionTab } from './tabs/PrescriptionTab';
import { ProgressTab } from './tabs/ProgressTab';
import { TagTab } from './tabs/TagTab';

/** The sections of a patient profile. The address picks the tab, and an unknown tab opens the overview. */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Details' },
  { id: 'prescription', label: 'Prescription' },
  { id: 'progress', label: 'Progress' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'tag', label: 'Tag & ID' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** The tab to show for a name from the address. */
function resolveTab(tab: string | undefined): TabId {
  return TABS.find((t) => t.id === tab)?.id ?? 'overview';
}

/** A patient's profile. The header shows the safety points an instructor needs at a glance, such as falls risk and beta blockers, above the tabs. */
export function PatientProfilePage({ patientId, tab }: { patientId: string; tab?: string }) {
  const { patients } = useData();
  const state = useAsync(() => patients.get(patientId), [patients, patientId]);
  const active = resolveTab(tab);

  if (state.loading && state.data === null && !state.error) return <Spinner />;
  if (state.error) return <Alert tone="error" title="Could not load this patient">{state.error.message}</Alert>;
  const patient = state.data;
  if (!patient) {
    return (
      <Alert tone="warning" title="Patient not found">
        <Link to="/patients" className="underline">Back to patients</Link>
      </Alert>
    );
  }

  const age = computeAge(patient.dateOfBirth);
  const onChanged = state.reload;

  return (
    <div className="space-y-6">
      <header data-rise className="space-y-4">
        <Link to="/patients" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-teal-700">
          <Icon name="back" /> All patients
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={`${patient.firstName} ${patient.lastName}`} size={56} />
          <div>
            <h1 className="text-[1.75rem] font-semibold leading-tight" data-testid="patient-name">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="text-sm text-slate-500">
              {patient.code}
              {age !== null ? ` · ${age} yrs` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="blue">{STREAM_LABELS[patient.stream]}</Badge>
          {patient.status === 'archived' ? <Badge tone="amber" icon="blocked">Archived</Badge> : null}
          {patient.tagId !== null ? <Badge icon="tag">Tag #{patient.tagId}</Badge> : null}
          {patient.fallsRisk === 'high' ? <Badge tone="red" icon="warning">High falls risk</Badge> : null}
          {patient.supervision === 'one_to_one' ? <Badge tone="violet" icon="user">Needs one-to-one help</Badge> : null}
          {patient.mobilityAid !== 'none' ? <Badge>Uses {patient.mobilityAid}</Badge> : null}
          {hasBetaBlocker(patient) ? <Badge tone="amber" icon="heart">Beta-blocker</Badge> : null}
          {!patient.consent.cameraTracking ? <Badge tone="amber" icon="camera">No camera consent</Badge> : null}
        </div>
      </header>

      <TabNav label="Patient sections" activeId={active} tabs={TABS.map((t) => ({ id: t.id, label: t.label, to: `/patients/${patient.id}/${t.id}` }))} />

      {active === 'overview' ? <OverviewTab patient={patient} /> : null}
      {active === 'details' ? <DetailsTab patient={patient} onChanged={onChanged} /> : null}
      {active === 'prescription' ? <PrescriptionTab patient={patient} /> : null}
      {active === 'progress' ? <ProgressTab patient={patient} /> : null}
      {active === 'calibration' ? <CalibrationTab patient={patient} /> : null}
      {active === 'tag' ? <TagTab patient={patient} onChanged={onChanged} /> : null}
    </div>
  );
}
