import { getExercise, stretchCoverage } from '../../domain';
import type { PrescribedExercise, SlotStatus } from '../../domain';
import { Card } from '../../ui/display';
import { Icon } from '../../ui/Icon';

export function SlotChecklist({ slots, exercises }: { slots: readonly SlotStatus[]; exercises: readonly PrescribedExercise[] }) {
  const stretch = stretchCoverage(exercises);
  const stretchCount = exercises.filter((e) => getExercise(e.exerciseId)?.category === 'stretch').length;
  return (
    <Card title="Session structure" description="Clinic template: 2 mobility, one per functional category, then stretches.">
      <ul className="space-y-1.5 text-sm" aria-label="Session structure">
        {slots.map(({ slot, have, met }) => (
          <li key={slot.id} className={met ? 'text-slate-800' : 'text-amber-800'}>
            <Icon name={met ? 'success' : 'hourglass'} className={`mr-1.5 ${met ? 'text-emerald-600' : 'text-amber-600'}`} />{slot.label}: {have}/{slot.min}
            <span className="sr-only">{met ? ' complete' : ' still needed'}</span>
          </li>
        ))}
      </ul>
      {stretchCount > 0 && stretch.missing.length > 0 ? (
        <p className="mt-3 text-xs text-slate-600">Stretches not yet covered: {stretch.missing.join(', ')}.</p>
      ) : null}
    </Card>
  );
}
