import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProgressReport } from '../src/domain';
import type { ExerciseResult, Patient, PatientSession } from '../src/domain';
import { buildReportHtml, cssString, escapeHtml, highlights } from '../src/features/progress/reportHtml';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 0, 5);

function result(over: Partial<ExerciseResult> = {}): ExerciseResult {
  return { exerciseId: 'goblet_squat', name: 'Goblet squat', tracking: 'scored', targetSets: 2, targetReps: 10, reps: 20, sets: 2, good: 14, needsCorrection: 4, flagged: 2, avgScore: 78, avgRom: 70, avgRepSeconds: 2, completed: true, ...over };
}

function session(id: string, day: number, exercises: ExerciseResult[]): PatientSession {
  const startedAt = MON + day * DAY;
  return { id, patientId: 'p1', startedAt, endedAt: startedAt + 1_800_000, exercises, savedBy: 'u1' };
}

const patient = { firstName: 'Ann', lastName: 'Lee <b>x</b>', code: 'P-0001', dateOfBirth: '1950-01-01', goals: 'Walk "further" & safer' } as Patient;

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('cssString', () => {
  it('cannot be closed early or break out of the style element', () => {
    assert.equal(cssString('a"b\\c</style>'), '"a\\"b\\\\c\\3c /style\\3e "');
    assert.ok(!cssString('</style><script>').includes('<'));
  });
});

describe('buildReportHtml', () => {
  const sessions = [
    session('a', 0, [result({ avgRom: 60, good: 10 }), result({ exerciseId: 'bird_dog', name: 'Bird dog' })]),
    session('b', 8, [result({ avgRom: 75, good: 17 }), result({ exerciseId: 'bird_dog', name: 'Bird dog' })]),
  ];
  const html = buildReportHtml(patient, buildProgressReport(sessions), Date.UTC(2026, 2, 1));

  it('is a complete document that names the patient and exercises', () => {
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Goblet squat'));
    assert.ok(html.includes('Bird dog'));
    assert.ok(html.includes('P-0001'));
  });

  it('never lets patient text inject markup', () => {
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(html.includes('Lee &lt;b&gt;x&lt;/b&gt;'));
    assert.ok(html.includes('Walk &quot;further&quot; &amp; safer'));
    assert.ok(!/<script/i.test(html));
    const nasty = buildReportHtml({ ...patient, lastName: '</style><script>alert(1)</script>' } as Patient, buildProgressReport(sessions), 0);
    assert.ok(!/<script/i.test(nasty));
    assert.equal((nasty.match(/<\/style>/g) ?? []).length, 1);
  });

  it('draws one chart per metric per exercise', () => {
    assert.equal((html.match(/class="chart"/g) ?? []).length, 6);
  });

  it('handles a single week and missing range of motion', () => {
    const one = buildReportHtml(patient, buildProgressReport([session('a', 0, [result({ avgRom: null, avgRepSeconds: null })])]), 0);
    assert.ok(one.includes('No data yet'));
    assert.ok(one.includes('Changes appear once there are two or more weeks'));
  });
});

describe('timed exercises in the report', () => {
  const timed = (day: number, best: number, completed: number) =>
    session(`t${day}`, day, [
      result({ exerciseId: 'wall_sit', name: 'Wall sit', tracking: 'timed', reps: completed, good: 0, avgScore: null, avgRom: null, avgRepSeconds: 30, holdAttempts: 3, holdsCompleted: completed, bestHoldSeconds: best, avgHoldSeconds: best - 4 }),
      result(),
    ]);
  const html = buildReportHtml(patient, buildProgressReport([timed(0, 10, 0), timed(8, 29, 2)]), 0);
  const [, wallSit = ''] = html.split('<h3>Wall sit</h3>');
  const wallSitSection = wallSit.split('</section>')[0]!;

  it('shows hold charts and a hold table for the timed exercise', () => {
    assert.ok(wallSitSection.includes('Longest hold'));
    assert.ok(wallSitSection.includes('Holds completed'));
    assert.ok(wallSitSection.includes('Holds attempted'));
    assert.ok(!wallSitSection.includes('Range of motion'));
    assert.ok(!wallSitSection.includes('Tempo'));
  });

  it('keeps range of motion and tempo for rep exercises on the same report', () => {
    const squat = html.split('<h3>Goblet squat</h3>')[1]!.split('</section>')[0]!;
    assert.ok(squat.includes('Range of motion'));
    assert.ok(squat.includes('Tempo'));
  });

  it('writes a highlight about the longer hold', () => {
    assert.match(highlights(buildProgressReport([timed(0, 10, 0), timed(8, 29, 2)])).join(' '), /longest hold is up 19 seconds/);
  });
});

describe('highlights', () => {
  it('reports improvements, regressions and readiness', () => {
    const better = buildProgressReport([
      session('a', 0, [result({ avgRom: 60, reps: 22, good: 12 })]),
      session('b', 8, [result({ avgRom: 72, reps: 24, good: 22 })]),
      session('c', 9, [result({ avgRom: 72, reps: 24, good: 22 })]),
    ]);
    const text = highlights(better).join(' ');
    assert.match(text, /range of motion is up/);
    assert.match(text, /good-rep rate is up/);
    assert.match(text, /ready to progress/);
    const worse = buildProgressReport([
      session('a', 0, [result({ avgRom: 80, reps: 20, good: 18 })]),
      session('b', 8, [result({ avgRom: 60, reps: 20, good: 8 })]),
    ]);
    assert.match(highlights(worse).join(' '), /Worth a look/);
  });

  it('asks for more data with a single week and caps the list', () => {
    const single = buildProgressReport([session('a', 0, [result()])]);
    assert.match(highlights(single).join(' '), /More weeks of data/);
    const many = Array.from({ length: 12 }, (_, i) => result({ exerciseId: `e${i}`, name: `E${i}`, avgRom: 50 }));
    const big = buildProgressReport([session('a', 0, many), session('b', 8, many.map((m) => ({ ...m, avgRom: 90 })))], 12);
    assert.ok(highlights(big).length <= 6);
  });
});
