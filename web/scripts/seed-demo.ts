import { readFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  buildNameKeys,
  buildProgressReport,
  cleanPatientData,
  formatPatientCode,
  hasErrors,
  MAX_TAG_ID,
  validatePatientData,
} from '../src/domain';
import type { PatientSession } from '../src/domain';
import { CAST } from './demo/cast';
import { buildSessions } from './demo/history';

const DEFAULT_WEEKS = 12;
const DEFAULT_SEED = 20260101;
const ACTOR = 'demo-seed';

interface Options {
  clearOnly: boolean;
  dryRun: boolean;
  weeks: number;
  seed: number;
}

function parseArgs(argv: readonly string[]): Options {
  const value = (flag: string, fallback: number): number => {
    const at = argv.indexOf(flag);
    const parsed = at >= 0 ? Number(argv[at + 1]) : fallback;
    if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} needs a positive number`);
    return Math.floor(parsed);
  };
  return {
    clearOnly: argv.includes('--clear'),
    dryRun: argv.includes('--dry-run'),
    weeks: value('--weeks', DEFAULT_WEEKS),
    seed: value('--seed', DEFAULT_SEED),
  };
}

function validateCast(): void {
  for (const person of CAST) {
    const errors = validatePatientData(cleanPatientData(person.data));
    if (hasErrors(errors)) throw new Error(`Demo person ${person.slug} is invalid: ${JSON.stringify(errors)}`);
  }
}

function summarize(slug: string, sessions: readonly PatientSession[]): string {
  const report = buildProgressReport(sessions);
  const heart = report.heart;
  const zone = heart?.inZoneRate === null || heart === null ? 'n/a' : `${Math.round(heart.inZoneRate * 100)}%`;
  const avg = heart?.avgBpm === null || heart === null ? 'n/a' : `${Math.round(heart.avgBpm)} bpm`;
  return `${slug.padEnd(18)} ${String(sessions.length).padStart(3)} sessions   heart avg ${avg.padEnd(8)} in zone ${zone}`;
}

function projectOf(): string {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account JSON file.');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { project_id?: string };
  return parsed.project_id ?? 'unknown project';
}

async function writeToFirestore(options: Options, plans: readonly { slug: string; sessions: (patientId: string) => PatientSession[] }[]): Promise<void> {
  const project = projectOf();
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const registryRef = db.doc('meta/registry');
  console.log(`Project: ${project}`);
  console.log('Looking for earlier demo patients...');

  const previous = new Map<string, { code: string; tagId: number | null }>();
  const old = await db.collection('patients').where('demo', '==', true).get();
  for (const snap of old.docs) {
    const data = snap.data();
    previous.set(snap.id, { code: String(data.code), tagId: typeof data.tagId === 'number' ? data.tagId : null });
  }
  for (const snap of old.docs) await db.recursiveDelete(snap.ref);
  await db.runTransaction(async (tx) => {
    const registry = (await tx.get(registryRef)).data() ?? { nextCode: 1, tags: {} };
    const tags = { ...(registry.tags ?? {}) } as Record<string, { patientId: string }>;
    for (const [tag, entry] of Object.entries(tags)) if (previous.has(entry.patientId)) delete tags[tag];
    tx.set(registryRef, { nextCode: registry.nextCode ?? 1, tags });
  });
  console.log(`Found ${old.size} earlier demo patient${old.size === 1 ? '' : 's'}.`);
  console.log(`Removed ${old.size} earlier demo patient${old.size === 1 ? '' : 's'}.`);
  if (options.clearOnly) return;

  const now = Date.now();
  const allocation = await db.runTransaction(async (tx) => {
    const registry = (await tx.get(registryRef)).data() ?? { nextCode: 1, tags: {} };
    const tags = { ...(registry.tags ?? {}) } as Record<string, unknown>;
    let nextCode = typeof registry.nextCode === 'number' ? registry.nextCode : 1;
    const taken = new Set(Object.keys(tags).map(Number));
    const issued = new Map<string, { code: string; tagId: number }>();
    for (const person of CAST) {
      const id = `demo-${person.slug}`;
      const before = previous.get(id);
      let tagId = before?.tagId ?? null;
      if (tagId === null || taken.has(tagId)) {
        tagId = null;
        for (let t = 0; t <= MAX_TAG_ID; t += 1) {
          if (!taken.has(t)) {
            tagId = t;
            break;
          }
        }
      }
      if (tagId === null) throw new Error('No free AprilTag ids left. Archive some patients first.');
      taken.add(tagId);
      const code = before?.code ?? formatPatientCode(nextCode++);
      issued.set(id, { code, tagId });
      tags[String(tagId)] = { patientId: id, code, boardName: person.data.boardName };
    }
    tx.set(registryRef, { nextCode, tags });
    return issued;
  });

  for (const [index, person] of CAST.entries()) {
    const id = `demo-${person.slug}`;
    const issued = allocation.get(id)!;
    const sessions = plans[index]!.sessions(id);
    const first = sessions[0]?.startedAt ?? now;
    const last = sessions[sessions.length - 1]?.endedAt ?? now;
    const data = cleanPatientData(person.data);
    const batch = db.batch();
    batch.set(db.doc(`patients/${id}`), {
      ...data,
      ...buildNameKeys(data.firstName, data.lastName),
      code: issued.code,
      tagId: issued.tagId,
      status: 'active',
      createdAt: first - 3 * 86_400_000,
      updatedAt: last,
      createdBy: ACTOR,
      prescriptionVersion: 1,
      demo: true,
    });
    batch.set(db.doc(`patients/${id}/prescriptions/v0001`), {
      ...person.content,
      patientId: id,
      version: 1,
      status: 'current',
      reason: 'Initial prescription',
      createdBy: ACTOR,
      createdAt: first - 3 * 86_400_000,
    });
    for (const session of sessions) batch.set(db.doc(`patients/${id}/sessions/${session.id}`), session);
    await batch.commit();
    console.log(`Added ${person.data.firstName} ${person.data.lastName} (${issued.code}, tag ${issued.tagId}) with ${sessions.length} sessions.`);
  }
}

async function main(): Promise<void> {
  console.log('Kinetra demo data seeder starting.');
  const options = parseArgs(process.argv.slice(2));
  validateCast();
  const now = Date.now();
  const plans = CAST.map((person, index) => ({
    slug: person.slug,
    sessions: (patientId: string) => buildSessions(person, patientId, { weeks: options.weeks, now, seed: options.seed }, index),
  }));

  if (options.dryRun) {
    console.log(`Dry run: ${CAST.length} people, ${options.weeks} weeks. Nothing is written.\n`);
    for (const plan of plans) console.log(summarize(plan.slug, plan.sessions('preview')));
    return;
  }
  await writeToFirestore(options, plans);
  if (!options.clearOnly) console.log('\nDone. Sign in to the web app and open Patients to see the demo people.');
}

const keepAlive = setInterval(() => undefined, 1000);

process.on('exit', (code) => {
  if (code !== 0) console.error(`Seeder stopped with exit code ${code}.`);
});

main()
  .then(() => {
    clearInterval(keepAlive);
    process.exit(0);
  })
  .catch((error: unknown) => {
    clearInterval(keepAlive);
    console.error('Seeding failed:', error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  });