import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, CATEGORY_ORDER, searchExercises } from '../../domain';
import type { ExerciseCategory, ExerciseDefinition } from '../../domain';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/display';
import { TextField } from '../../ui/fields';
import { TrackingBadge } from './TrackingBadge';

/** The props for the picker. Exercises already prescribed are passed in so they can be shown as added. */
interface ExercisePickerProps {
  existingIds: ReadonlySet<string>;
  onAdd: (exercise: ExerciseDefinition) => void;
  onClose: () => void;
}

/** A searchable list of the exercise library with a category filter. */
export function ExercisePicker({ existingIds, onAdd, onClose }: ExercisePickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ExerciseCategory | 'all'>('all');
  const results = useMemo(() => searchExercises(query, category === 'all' ? undefined : category), [query, category]);

  return (
    <Card
      title="Add an exercise"
      actions={<Button variant="ghost" size="sm" icon="close" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <TextField label="Search exercises" name="exerciseSearch" value={query} onChange={setQuery} placeholder="e.g. squat, band, curl" autoComplete="off" />
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {(['all', ...CATEGORY_ORDER] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${category === c ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
            >
              {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" aria-label="Exercise library">
          {results.length === 0 ? <li className="p-4 text-sm text-slate-600">No exercises match.</li> : null}
          {results.map((e) => {
            const added = existingIds.has(e.id);
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{CATEGORY_LABELS[e.category]}{e.equipment ? ` · ${e.equipment}` : ''}</span>
                </span>
                <span className="flex items-center gap-2">
                  <TrackingBadge mode={e.tracking} />
                  <Button size="sm" variant="secondary" icon={added ? 'check' : 'plus'} disabled={added} aria-label={`Add ${e.name}`} onClick={() => onAdd(e)}>
                    {added ? 'Added' : 'Add'}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
