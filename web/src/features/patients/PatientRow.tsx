import { computeAge } from '../../domain';
import type { Patient } from '../../domain';
import { Link } from '../../app/router';
import { Avatar, Badge } from '../../ui/display';
import { Icon } from '../../ui/Icon';
import { STREAM_LABELS } from './labels';

/** One patient in a list, linking to their profile. */
export function PatientRow({ patient, rise = true }: { patient: Patient; rise?: boolean }) {
  const age = computeAge(patient.dateOfBirth);
  return (
    <li {...(rise ? { 'data-rise': '' } : {})}>
      <Link
        to={`/patients/${patient.id}`}
        data-hover="row"
        className="relative flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-teal-50/70"
      >
        <span data-hover-bar aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] origin-center scale-y-0 rounded-full bg-teal-600 opacity-0" />
        <span className="flex items-center gap-3">
          <Avatar name={`${patient.firstName} ${patient.lastName}`} size={36} />
          <span>
            <span className="font-medium text-slate-900">
              {patient.lastName}, {patient.firstName}
            </span>
            <span className="ml-2 text-sm text-slate-500">
              {patient.code}
              {age !== null ? ` · ${age} yrs` : ''}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge tone="blue">{STREAM_LABELS[patient.stream]}</Badge>
          {patient.status === 'archived' ? <Badge tone="amber">Archived</Badge> : null}
          {patient.tagId !== null ? <Badge icon="tag">Tag #{patient.tagId}</Badge> : null}
          <span data-hover-arrow className="text-slate-400"><Icon name="next" /></span>
        </span>
      </Link>
    </li>
  );
}