import type { LiveParticipant } from '../../services/hub/types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/motion/ProgressBar';
import { HeartReadout } from './HeartReadout';
import { StatusLight } from './StatusLight';
import { LIGHTS, prescriptionLine, progressFraction, progressLabel } from './roster';

/** The last few form scores as small coloured chips. The colours match the good, fair and poor bands. */
function ScoreChips({ scores }: { scores: readonly number[] }) {
  return (
    <ul className="flex items-center gap-1" aria-label="Recent form scores">
      {scores.map((raw, i) => {
        const score = Math.round(raw);
        const tone = score >= 80 ? 'bg-emerald-100 text-emerald-900' : score >= 50 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900';
        return (
          <li key={i} className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{score}</li>
        );
      })}
    </ul>
  );
}

/** One person's card on the instructor screen, with a button to move them to the next exercise. */
export function ParticipantCard({ person, onNext, busy }: { person: LiveParticipant; onNext: (patientId: string) => void; busy: boolean }) {
  const { exercise, progress } = person;
  return (
    <li
      data-rise
      data-hover="lift"
      className={`flex flex-col rounded-(--radius-card) border border-l-4 border-slate-200 bg-white p-4 shadow-card ${LIGHTS[person.light].stripe}`}
      aria-label={`${person.board_name}: ${LIGHTS[person.light].label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold leading-tight text-slate-900">{person.board_name}</h3>
        <StatusLight light={person.light} />
      </div>

      {exercise ? (
        <div className="mt-3 flex-1 space-y-2.5 text-sm">
          <div>
            <p className="font-semibold text-slate-900">{exercise.name} <span className="font-normal text-slate-500">({exercise.index + 1} of {exercise.total})</span></p>
            <p className="text-slate-600">{prescriptionLine(exercise)}</p>
          </div>
          <div>
            <p className="mb-1.5 flex items-center justify-between text-slate-800">{progressLabel(exercise, progress)}</p>
            <ProgressBar value={progressFraction(exercise, progress)} label={`${person.board_name} progress`} barClassName={LIGHTS[person.light].dot} />
          </div>
          {person.recent_scores.length > 0 ? (
            <div className="flex items-center gap-2 text-slate-600">
              <span className="text-xs">Recent form</span>
              <ScoreChips scores={person.recent_scores} />
            </div>
          ) : null}
          <HeartReadout heart={person.heart_rate} />
          <p className="text-slate-600">{person.reason}</p>
        </div>
      ) : (
        <p className="mt-3 flex flex-1 items-center gap-2 text-sm text-slate-700"><Icon name="finished" className="text-teal-700" /> Finished every exercise.</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Icon name="camera" /> {person.present ? `Seen by ${person.cameras.join(', ')}` : 'Not in view'}
        </span>
        {exercise ? (
          <Button size="sm" variant="secondary" iconAfter="next" disabled={busy} onClick={() => onNext(person.patient_id)} aria-label={`Move ${person.board_name} to the next exercise`}>
            {exercise.next ? `Next: ${exercise.next}` : 'Mark finished'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
