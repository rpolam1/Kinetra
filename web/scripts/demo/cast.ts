import { emptyPatientData, getExercise } from '../../src/domain';
import type { CardioBlock, PatientData, PrescribedExercise, PrescriptionContent } from '../../src/domain';

/** The curve a person's progress follows over the weeks. */
export type Shape = 'steady' | 'fast' | 'late' | 'plateau' | 'dip';

/** The story of one demo person. Each pair of from and to values is where a measure starts and where it ends, and miss is the chance of skipping a session. */
export interface Arc {
  perWeek: number;
  miss: number;
  shape: Shape;
  watchRate: number;
  scoreFrom: number;
  scoreTo: number;
  volumeFrom: number;
  volumeTo: number;
  romFrom: number;
  romTo: number;
  tempoFrom: number;
  tempoTo: number;
  holdFrom: number;
  holdTo: number;
  hrFrom: number;
  hrTo: number;
  zoneFrom: number;
  zoneTo: number;
  minutes: number;
}

/** A made up person with their record, prescription and progress story. */
export interface DemoPerson {
  slug: string;
  data: PatientData;
  content: PrescriptionContent;
  arc: Arc;
}

/** A prescribed exercise with sensible defaults. It throws for an id that is not in the library, so typos are caught when the seeder starts. */
function exercise(exerciseId: string, sets: number, reps: number | null, seconds: number | null = null, load = ''): PrescribedExercise {
  const def = getExercise(exerciseId);
  if (!def) throw new Error(`Demo cast uses unknown exercise ${exerciseId}`);
  const counted = def.tracking === 'scored' || def.tracking === 'count_only';
  return {
    exerciseId,
    sets,
    reps,
    seconds,
    load,
    modification: '',
    notes: '',
    progression: counted ? 'twenty_reps_two_sessions' : 'manual',
  };
}

/** A cardio block with a warm up and cool down of five minutes. */
function cardio(machine: CardioBlock['machine'], mainMin: number, low = 40, high = 60): CardioBlock {
  return { machine, warmupMin: 5, mainMin, cooldownMin: 5, intensityLowPct: low, intensityHighPct: high, notes: '' };
}

/** Fills in a patient record from a slug such as margaret-chen. The name and board name come from the slug. */
function person(slug: string, overrides: Partial<PatientData>): PatientData {
  const [first = '', last = ''] = slug.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return {
    ...emptyPatientData(),
    firstName: first,
    lastName: last,
    boardName: `${first} ${last.charAt(0)}.`,
    consent: { exercise: true, cameraTracking: true, signedOn: '2026-07-20' },
    ...overrides,
  };
}

// Phone numbers use the reserved 555 range so they can never reach a real person
const phone = (n: number): string => `519-555-01${String(n).padStart(2, '0')}`;

// The made up people for the demo. They cover steady, fast, late, plateau and dip progress, and some are on beta blockers or have no watch.
export const CAST: readonly DemoPerson[] = [
  {
    slug: 'margaret-chen',
    data: person('margaret-chen', {
      dateOfBirth: '1951-03-14',
      phone: phone(11),
      email: 'margaret.chen@example.com',
      emergencyContact: { name: 'David Chen', phone: phone(12), relationship: 'Son' },
      stream: 'general',
      referralSource: 'physician',
      diagnoses: ['Osteoarthritis (knees)', 'Hypertension'],
      medications: [{ name: 'Amlodipine', betaBlocker: false }],
      restingHr: 74,
      maxHr: null,
      baselineTests: [{ name: '30-second chair stand', result: '9 reps', date: '2026-07-22' }],
      goals: 'Walk to the shops without stopping and climb stairs comfortably.',
      precautions: 'Avoid deep knee flexion beyond 90 degrees.',
    }),
    content: {
      exercises: [
        exercise('ball_squat', 2, 12),
        exercise('wall_sit', 2, null, 30),
        exercise('seated_row', 2, 12),
        exercise('chest_press', 2, 12),
        exercise('glute_bridge', 2, 12),
        exercise('hamstring_stretch', 2, null, 30),
      ],
      cardio: cardio('recumbent_bike', 20),
    },
    arc: {
      perWeek: 3, miss: 0.08, shape: 'fast', watchRate: 0.9,
      scoreFrom: 58, scoreTo: 91, volumeFrom: 0.78, volumeTo: 1, romFrom: 64, romTo: 88,
      tempoFrom: 3.6, tempoTo: 2.7, holdFrom: 18, holdTo: 52, hrFrom: 0.66, hrTo: 0.5,
      zoneFrom: 0.34, zoneTo: 0.8, minutes: 32,
    },
  },
  {
    slug: 'robert-okafor',
    data: person('robert-okafor', {
      dateOfBirth: '1958-09-02',
      phone: phone(21),
      email: 'robert.okafor@example.com',
      emergencyContact: { name: 'Grace Okafor', phone: phone(22), relationship: 'Spouse' },
      stream: 'stroke',
      referralSource: 'GRH',
      diagnoses: ['Ischemic stroke (2025)', 'Atrial fibrillation'],
      medications: [{ name: 'Metoprolol', betaBlocker: true }, { name: 'Apixaban', betaBlocker: false }],
      affectedSide: 'left',
      mobilityAid: 'cane',
      fallsRisk: 'moderate',
      supervision: 'check_in',
      restingHr: 62,
      maxHr: null,
      baselineTests: [{ name: 'Timed up and go', result: '17 s', date: '2026-07-24' }],
      goals: 'Regain left arm strength and walk without the cane.',
      precautions: 'Beta blocker: heart rate does not reflect effort. Use perceived exertion.',
    }),
    content: {
      exercises: [
        exercise('box_squat', 2, 10),
        exercise('wall_push_up', 2, 10),
        exercise('lat_pulldown', 2, 10),
        exercise('bicep_curl', 2, 10),
        exercise('bird_dog', 2, 8),
        exercise('calf_stretch', 2, null, 30),
      ],
      cardio: cardio('recumbent_bike', 15, 30, 50),
    },
    arc: {
      perWeek: 3, miss: 0.14, shape: 'steady', watchRate: 0.85,
      scoreFrom: 52, scoreTo: 78, volumeFrom: 0.68, volumeTo: 0.97, romFrom: 52, romTo: 72,
      tempoFrom: 4.1, tempoTo: 3.2, holdFrom: 14, holdTo: 34, hrFrom: 0.38, hrTo: 0.34,
      zoneFrom: 0.4, zoneTo: 0.5, minutes: 30,
    },
  },
  {
    slug: 'linda-tremblay',
    data: person('linda-tremblay', {
      dateOfBirth: '1963-06-21',
      phone: phone(31),
      email: 'linda.tremblay@example.com',
      emergencyContact: { name: 'Marc Tremblay', phone: phone(32), relationship: 'Spouse' },
      stream: 'cancer',
      referralSource: 'WRHN',
      diagnoses: ['Breast cancer, post-chemotherapy'],
      medications: [{ name: 'Letrozole', betaBlocker: false }],
      restingHr: 78,
      maxHr: null,
      baselineTests: [{ name: '6-minute walk', result: '382 m', date: '2026-07-28' }],
      goals: 'Rebuild stamina and shoulder mobility after treatment.',
      precautions: 'Fatigue varies with treatment cycles. Reduce volume if exhausted.',
    }),
    content: {
      exercises: [
        exercise('goblet_squat', 2, 10),
        exercise('shoulder_press', 2, 10),
        exercise('seated_row', 2, 12),
        exercise('plank', 2, null, 20),
        exercise('hammer_curl', 2, 12),
        exercise('upper_back_stretch', 2, null, 30),
      ],
      cardio: cardio('elliptical', 20),
    },
    arc: {
      perWeek: 3, miss: 0.1, shape: 'dip', watchRate: 0.9,
      scoreFrom: 60, scoreTo: 88, volumeFrom: 0.8, volumeTo: 1, romFrom: 66, romTo: 90,
      tempoFrom: 3.4, tempoTo: 2.8, holdFrom: 12, holdTo: 38, hrFrom: 0.64, hrTo: 0.5,
      zoneFrom: 0.3, zoneTo: 0.74, minutes: 34,
    },
  },
  {
    slug: 'harold-whitfield',
    data: person('harold-whitfield', {
      dateOfBirth: '1947-11-30',
      phone: phone(41),
      emergencyContact: { name: 'Susan Whitfield', phone: phone(42), relationship: 'Daughter' },
      stream: 'general',
      referralSource: 'physician',
      diagnoses: ['COPD (mild)', 'Type 2 diabetes'],
      medications: [{ name: 'Metformin', betaBlocker: false }, { name: 'Salbutamol inhaler', betaBlocker: false }],
      fallsRisk: 'high',
      supervision: 'one_to_one',
      restingHr: 82,
      maxHr: null,
      baselineTests: [{ name: '30-second chair stand', result: '7 reps', date: '2026-07-29' }],
      goals: 'Keep independent at home and reduce breathlessness on stairs.',
      precautions: 'Monitor breathing. Rest between sets. Check blood sugar before sessions.',
    }),
    content: {
      exercises: [
        exercise('box_squat', 2, 10),
        exercise('wall_push_up', 2, 10),
        exercise('band_row', 2, 12),
        exercise('dead_bug', 2, 8),
        exercise('quad_stretch', 2, null, 30),
      ],
      cardio: cardio('recumbent_bike', 15),
    },
    arc: {
      perWeek: 2, miss: 0.12, shape: 'plateau', watchRate: 0.8,
      scoreFrom: 54, scoreTo: 74, volumeFrom: 0.72, volumeTo: 0.9, romFrom: 50, romTo: 66,
      tempoFrom: 4.0, tempoTo: 3.4, holdFrom: 12, holdTo: 26, hrFrom: 0.66, hrTo: 0.56,
      zoneFrom: 0.28, zoneTo: 0.5, minutes: 28,
    },
  },
  {
    slug: 'priya-nair',
    data: person('priya-nair', {
      dateOfBirth: '1972-02-09',
      phone: phone(51),
      email: 'priya.nair@example.com',
      emergencyContact: { name: 'Arjun Nair', phone: phone(52), relationship: 'Spouse' },
      stream: 'graduate',
      referralSource: 'self',
      diagnoses: ['Rotator cuff repair (2026)'],
      medications: [],
      restingHr: 64,
      maxHr: 178,
      baselineTests: [{ name: 'Push-up test', result: '6 reps', date: '2026-07-30' }],
      goals: 'Return to recreational tennis.',
      precautions: 'No overhead load above 5 kg until cleared.',
    }),
    content: {
      exercises: [
        exercise('goblet_squat', 2, 12),
        exercise('push_up', 2, 10),
        exercise('bent_over_row', 2, 12),
        exercise('romanian_deadlift', 2, 12),
        exercise('side_plank', 2, null, 25),
        exercise('lunge', 2, 10),
      ],
      cardio: cardio('treadmill', 25, 50, 70),
    },
    arc: {
      perWeek: 3, miss: 0.06, shape: 'late', watchRate: 0.95,
      scoreFrom: 66, scoreTo: 94, volumeFrom: 0.85, volumeTo: 1.02, romFrom: 70, romTo: 94,
      tempoFrom: 3.0, tempoTo: 2.4, holdFrom: 20, holdTo: 58, hrFrom: 0.66, hrTo: 0.6,
      zoneFrom: 0.42, zoneTo: 0.84, minutes: 36,
    },
  },
  {
    slug: 'dennis-boucher',
    data: person('dennis-boucher', {
      dateOfBirth: '1955-07-18',
      phone: phone(61),
      emergencyContact: { name: 'Claire Boucher', phone: phone(62), relationship: 'Spouse' },
      stream: 'other',
      referralSource: 'physician',
      diagnoses: ['Total hip replacement (2026)'],
      medications: [{ name: 'Acetaminophen', betaBlocker: false }],
      mobilityAid: 'cane',
      fallsRisk: 'moderate',
      supervision: 'check_in',
      restingHr: 70,
      maxHr: null,
      baselineTests: [{ name: 'Timed up and go', result: '13 s', date: '2026-08-02' }],
      goals: 'Walk 30 minutes without pain.',
      precautions: 'Hip precautions: no flexion past 90 degrees, no crossing legs.',
    }),
    content: {
      exercises: [
        exercise('step_up', 2, 10),
        exercise('glute_bridge', 2, 12),
        exercise('chest_press', 2, 12),
        exercise('seated_row', 2, 12),
        exercise('hip_flexor_stretch', 2, null, 30),
      ],
      cardio: cardio('recumbent_bike', 20),
    },
    arc: {
      perWeek: 3, miss: 0.1, shape: 'steady', watchRate: 0.88,
      scoreFrom: 56, scoreTo: 86, volumeFrom: 0.74, volumeTo: 1, romFrom: 58, romTo: 82,
      tempoFrom: 3.8, tempoTo: 2.9, holdFrom: 15, holdTo: 44, hrFrom: 0.64, hrTo: 0.52,
      zoneFrom: 0.36, zoneTo: 0.78, minutes: 31,
    },
  },
  {
    slug: 'aisha-rahman',
    data: person('aisha-rahman', {
      dateOfBirth: '1969-12-05',
      phone: phone(71),
      email: 'aisha.rahman@example.com',
      emergencyContact: { name: 'Omar Rahman', phone: phone(72), relationship: 'Brother' },
      stream: 'general',
      referralSource: 'self',
      diagnoses: ['Fibromyalgia'],
      medications: [{ name: 'Duloxetine', betaBlocker: false }],
      restingHr: 72,
      maxHr: null,
      baselineTests: [{ name: '30-second chair stand', result: '11 reps', date: '2026-08-04' }],
      goals: 'Build energy for daily life and reduce flare-ups.',
      precautions: 'Pace the session. Stop if a flare-up starts.',
    }),
    content: {
      exercises: [
        exercise('goblet_squat', 2, 10),
        exercise('bicep_curl', 2, 12),
        exercise('lat_pulldown', 2, 12),
        exercise('plank', 2, null, 20),
        exercise('childs_pose', 2, null, 30),
      ],
      cardio: cardio('elliptical', 15, 35, 55),
    },
    arc: {
      perWeek: 2, miss: 0.2, shape: 'steady', watchRate: 0.85,
      scoreFrom: 62, scoreTo: 82, volumeFrom: 0.8, volumeTo: 0.98, romFrom: 66, romTo: 82,
      tempoFrom: 3.5, tempoTo: 3.0, holdFrom: 14, holdTo: 36, hrFrom: 0.55, hrTo: 0.5,
      zoneFrom: 0.38, zoneTo: 0.7, minutes: 28,
    },
  },
  {
    slug: 'george-kowalski',
    data: person('george-kowalski', {
      dateOfBirth: '1944-05-27',
      phone: phone(81),
      emergencyContact: { name: 'Anna Kowalski', phone: phone(82), relationship: 'Daughter' },
      stream: 'graduate',
      referralSource: 'physician',
      diagnoses: ["Parkinson's disease"],
      medications: [{ name: 'Levodopa', betaBlocker: false }],
      fallsRisk: 'moderate',
      supervision: 'check_in',
      restingHr: 76,
      maxHr: null,
      baselineTests: [{ name: 'Timed up and go', result: '14 s', date: '2026-08-05' }],
      goals: 'Maintain balance and stride length.',
      precautions: 'Schedule sessions when medication is working.',
    }),
    content: {
      exercises: [
        exercise('box_squat', 2, 10),
        exercise('seated_row', 2, 10),
        exercise('front_raise', 2, 10),
        exercise('glute_bridge', 2, 10),
        exercise('cat_cow', 2, 10),
      ],
      cardio: cardio('recumbent_bike', 20),
    },
    arc: {
      perWeek: 2, miss: 0.12, shape: 'steady', watchRate: 0.8,
      scoreFrom: 55, scoreTo: 76, volumeFrom: 0.76, volumeTo: 0.95, romFrom: 54, romTo: 70,
      tempoFrom: 4.0, tempoTo: 3.4, holdFrom: 12, holdTo: 28, hrFrom: 0.62, hrTo: 0.52,
      zoneFrom: 0.32, zoneTo: 0.64, minutes: 29,
    },
  },
];