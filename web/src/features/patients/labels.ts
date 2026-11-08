import type {
  AffectedSide,
  FallsRisk,
  MobilityAid,
  ProgramStream,
  ReferralSource,
  SupervisionLevel,
} from '../../domain';

export const STREAM_LABELS: Record<ProgramStream, string> = {
  general: 'General program',
  cancer: 'Cancer care',
  stroke: 'Stroke recovery',
  graduate: 'Graduate (self-managed)',
  other: 'Other',
};
export const REFERRAL_LABELS: Record<ReferralSource, string> = {
  WRHN: 'WRHN',
  GRH: 'Grand River Hospital',
  physician: 'Physician / clinic',
  self: 'Self-referral',
  other: 'Other',
};
export const SIDE_LABELS: Record<AffectedSide, string> = {
  none: 'None / not applicable',
  left: 'Left',
  right: 'Right',
  both: 'Both',
};
export const AID_LABELS: Record<MobilityAid, string> = {
  none: 'None',
  cane: 'Cane',
  walker: 'Walker',
  wheelchair: 'Wheelchair',
};
export const FALLS_LABELS: Record<FallsRisk, string> = { low: 'Low', moderate: 'Moderate', high: 'High' };
export const SUPERVISION_LABELS: Record<SupervisionLevel, string> = {
  independent: 'Independent',
  check_in: 'Needs check-ins',
  one_to_one: 'Needs one-to-one help',
};

export function toOptions<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
