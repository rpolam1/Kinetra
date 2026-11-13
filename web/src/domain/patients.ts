import type { Patient, PatientData } from './types';

/** Highest AprilTag id. The 36h11 family has ids 0 to 586, which is also the limit the hub enforces. */
export const MAX_TAG_ID = 586;
/** Shorter name searches are treated as empty so the list does not search on one letter. */
export const MIN_NAME_QUERY_LENGTH = 2;

/** A blank form with safe defaults. Consent starts as not given. */
export function emptyPatientData(): PatientData {
  return {
    firstName: '',
    lastName: '',
    boardName: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    emergencyContact: { name: '', phone: '', relationship: '' },
    stream: 'general',
    referralSource: 'self',
    referralNotes: '',
    diagnoses: [],
    medications: [],
    precautions: '',
    affectedSide: 'none',
    mobilityAid: 'none',
    fallsRisk: 'low',
    supervision: 'independent',
    restingHr: null,
    maxHr: null,
    baselineTests: [],
    goals: '',
    consent: { exercise: false, cameraTracking: false, signedOn: '' },
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form. Dates such as 2024-02-31 are rejected. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Age in whole years, or null for an invalid date or one in the future. */
export function computeAge(dateOfBirth: string, today: Date = new Date()): number | null {
  if (!isValidIsoDate(dateOfBirth)) return null;
  const [y, mo, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getFullYear() - y;
  const hadBirthday =
    today.getMonth() + 1 > mo || (today.getMonth() + 1 === mo && today.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/** Today's date as YYYY-MM-DD in the local time zone, because the person thinks in local dates. */
export function todayIso(today: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

/** Lowercase, trimmed text with accents removed, so searches ignore case and accents. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** The two forms of the name that searches compare against, last name first and first name first. */
export function buildNameKeys(firstName: string, lastName: string): { nameKey: string; nameKeyAlt: string } {
  const first = normalizeText(firstName);
  const last = normalizeText(lastName);
  return { nameKey: `${last} ${first}`.trim(), nameKeyAlt: `${first} ${last}`.trim() };
}

/** The name shown on the public board. A first name and last initial keeps the full name private. */
export function defaultBoardName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/** Patient codes look like P-0007. */
export function formatPatientCode(sequence: number): string {
  return `P-${String(sequence).padStart(4, '0')}`;
}

export type SearchIntent =
  | { kind: 'empty' }
  | { kind: 'code'; code: string }
  | { kind: 'tag'; tagId: number }
  | { kind: 'name'; prefix: string };

/** Decide what a search box entry means. It can be a patient code, a tag number, a name prefix or nothing useful. */
export function classifySearchQuery(raw: string): SearchIntent {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };

  // The dash in a code is optional
  const code = /^p-?(\d{1,6})$/i.exec(text);
  if (code) return { kind: 'code', code: formatPatientCode(Number(code[1])) };

  // A bare number up to three digits is read as a tag id
  const tag = /^#?(\d{1,3})$/.exec(text);
  if (tag) {
    const tagId = Number(tag[1]);
    return tagId <= MAX_TAG_ID ? { kind: 'tag', tagId } : { kind: 'empty' };
  }

  const prefix = normalizeText(text);
  return prefix.length >= MIN_NAME_QUERY_LENGTH ? { kind: 'name', prefix } : { kind: 'empty' };
}

/** Error messages keyed by field path, for example emergencyContact.phone. */
export type FieldErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

function validPhone(value: string): boolean {
  const n = digitCount(value);
  return n >= 7 && n <= 15;
}

/** Check a patient form. Only the first message for each field is kept. */
export function validatePatientData(data: PatientData, today: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => {
    if (!(key in errors)) errors[key] = message;
  };

  if (!data.firstName.trim()) add('firstName', 'First name is required');
  else if (data.firstName.trim().length > 60) add('firstName', 'Keep it under 60 characters');
  if (!data.lastName.trim()) add('lastName', 'Last name is required');
  else if (data.lastName.trim().length > 60) add('lastName', 'Keep it under 60 characters');
  if (!data.boardName.trim()) add('boardName', 'Board name is required (shown on the public screen)');
  else if (data.boardName.trim().length > 24) add('boardName', 'Keep it under 24 characters');

  if (!data.dateOfBirth) {
    add('dateOfBirth', 'Date of birth is required');
  } else if (!isValidIsoDate(data.dateOfBirth)) {
    add('dateOfBirth', 'Enter a valid date');
  } else {
    const age = computeAge(data.dateOfBirth, today);
    if (age === null) add('dateOfBirth', 'Date of birth cannot be in the future');
    else if (age > 120) add('dateOfBirth', 'Check the year: age would be over 120');
  }

  if (data.phone && !validPhone(data.phone)) add('phone', 'Enter a valid phone number');
  if (data.email && !EMAIL.test(data.email.trim())) add('email', 'Enter a valid email address');

  const ec = data.emergencyContact;
  if (ec.name || ec.phone || ec.relationship) {
    if (!ec.name.trim()) add('emergencyContact.name', 'Contact name is required');
    if (!ec.phone.trim()) add('emergencyContact.phone', 'Contact phone is required');
    else if (!validPhone(ec.phone)) add('emergencyContact.phone', 'Enter a valid phone number');
  }

  if (data.restingHr !== null && (data.restingHr < 30 || data.restingHr > 130)) {
    add('restingHr', 'Resting heart rate should be 30-130 bpm');
  }
  if (data.maxHr !== null && (data.maxHr < 90 || data.maxHr > 220)) {
    add('maxHr', 'Maximum heart rate should be 90-220 bpm');
  }
  if (data.restingHr !== null && data.maxHr !== null && data.maxHr < data.restingHr + 20) {
    add('maxHr', 'Maximum must be at least 20 bpm above resting');
  }

  data.diagnoses.forEach((d, i) => {
    if (!d.trim()) add(`diagnoses.${i}`, 'Remove empty entries');
    else if (d.length > 100) add(`diagnoses.${i}`, 'Keep it under 100 characters');
  });
  data.medications.forEach((m, i) => {
    if (!m.name.trim()) add(`medications.${i}.name`, 'Medication name is required');
  });
  data.baselineTests.forEach((t, i) => {
    if (!t.name.trim()) add(`baselineTests.${i}.name`, 'Test name is required');
    if (!t.result.trim()) add(`baselineTests.${i}.result`, 'Result is required');
    if (t.date && !isValidIsoDate(t.date)) add(`baselineTests.${i}.date`, 'Enter a valid date');
  });

  if (data.precautions.length > 2000) add('precautions', 'Keep it under 2000 characters');
  if (data.goals.length > 2000) add('goals', 'Keep it under 2000 characters');
  if (data.referralNotes.length > 1000) add('referralNotes', 'Keep it under 1000 characters');

  // Consent has to be dated whenever either kind is given
  if (data.consent.exercise || data.consent.cameraTracking) {
    if (!isValidIsoDate(data.consent.signedOn)) {
      add('consent.signedOn', 'Enter the date consent was signed');
    } else if (data.consent.signedOn > todayIso(today)) {
      add('consent.signedOn', 'Consent date cannot be in the future');
    }
  }
  return errors;
}

/** True when there is at least one error. */
export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Trim text fields and drop empty list entries before saving. */
export function cleanPatientData(data: PatientData): PatientData {
  return {
    ...data,
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    boardName: data.boardName.trim(),
    phone: data.phone.trim(),
    email: data.email.trim(),
    referralNotes: data.referralNotes.trim(),
    precautions: data.precautions.trim(),
    goals: data.goals.trim(),
    diagnoses: data.diagnoses.map((d) => d.trim()).filter(Boolean),
    medications: data.medications.map((m) => ({ ...m, name: m.name.trim() })),
    emergencyContact: {
      name: data.emergencyContact.name.trim(),
      phone: data.emergencyContact.phone.trim(),
      relationship: data.emergencyContact.relationship.trim(),
    },
    baselineTests: data.baselineTests.map((t) => ({
      name: t.name.trim(),
      result: t.result.trim(),
      date: t.date,
    })),
  };
}

/** Remove the fields the system fills in, leaving what an instructor edits. */
export function toPatientData(patient: Patient): PatientData {
  const {
    id: _id,
    code: _code,
    tagId: _tagId,
    status: _status,
    nameKey: _nameKey,
    nameKeyAlt: _nameKeyAlt,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    prescriptionVersion: _prescriptionVersion,
    ...data
  } = patient;
  return data;
}
