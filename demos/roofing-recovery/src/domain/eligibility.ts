import { daysBetween } from './dates.ts';
import type { Channel, Consent, EstimateRecord, Pilot, SuppressionEntry, WorkbenchState } from './types.ts';

/*
 * Eligibility and contact-permission checks. These record evidence and enforce
 * operator decisions; they are not legal determinations.
 */

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export function findPilot(state: WorkbenchState, pilotId: string): Pilot | undefined {
  return state.pilots.find((p) => p.id === pilotId);
}

/** Active suppression-ledger entries for this contractor matching the email or phone. */
export function ledgerMatches(
  state: WorkbenchState,
  contractorId: string,
  email: string | null,
  phone: string | null,
): SuppressionEntry[] {
  return state.suppression.filter(
    (e) => e.active && e.contractorId === contractorId && ((email && e.email === email) || (phone && e.phone === phone)),
  );
}

const consentFor = (record: EstimateRecord, channel: Channel): Consent =>
  channel === 'email' ? record.authorization.emailConsent : channel === 'phone' ? record.authorization.phoneConsent : record.authorization.smsConsent;

/** Channels this record may be contacted on: approved for the pilot, contact detail present and documented consent. */
export function permittedChannels(record: EstimateRecord, pilot: Pilot): Channel[] {
  return pilot.approvedChannels.filter((c) => {
    const hasDetail = c === 'email' ? record.email !== null : record.phone !== null;
    return hasDetail && consentFor(record, c) === 'yes';
  });
}

/** Data-quality problems shown on review screens. */
export function dataIssues(record: EstimateRecord, today: string): Issue[] {
  const issues: Issue[] = [];
  const o = record.original;
  if (!record.email && !record.phone) issues.push({ level: 'error', message: 'No usable email or phone number' });
  if (!record.email && (o.customer_email ?? '').trim() !== '') issues.push({ level: 'warning', message: `Email "${o.customer_email}" is not a valid address` });
  if (!record.phone && (o.customer_phone ?? '').trim() !== '') issues.push({ level: 'warning', message: `Phone "${o.customer_phone}" is not a valid US number` });
  if (record.estimateAmount <= 0) issues.push({ level: 'warning', message: 'Estimate amount is missing or zero' });
  if (record.estimateStatus === 'unknown') issues.push({ level: 'warning', message: 'Estimate status unknown — confirm with contractor' });
  if (!record.lastContactDate) issues.push({ level: 'warning', message: 'Last contact date missing' });
  if (record.lastContactDate && record.lastContactDate > today) issues.push({ level: 'error', message: 'Last contact date is in the future' });
  if (record.authorization.evidence.trim() === '') issues.push({ level: 'error', message: 'No authorization evidence recorded' });
  const a = record.authorization;
  if (a.emailConsent === 'unknown' && a.phoneConsent === 'unknown' && a.smsConsent === 'unknown') {
    issues.push({ level: 'error', message: 'Communication authorization unknown for every channel' });
  }
  if (!record.service.trim()) issues.push({ level: 'warning', message: 'Service requested is missing' });
  return issues;
}

/** Why this record cannot be marked eligible. Empty = the operator may mark it eligible. */
export function eligibilityBlockers(state: WorkbenchState, record: EstimateRecord): string[] {
  const pilot = findPilot(state, record.pilotId);
  if (!pilot) return ['Pilot not found'];
  const blockers: string[] = [];
  if (record.estimateStatus !== 'open') blockers.push(`Estimate status is "${record.estimateStatus}" — only open estimates can be contacted`);
  if (!record.email && !record.phone) blockers.push('No usable contact details');
  if (record.authorization.priorOptOut) blockers.push('Previous opt-out recorded');
  if (record.authorization.evidence.trim() === '') blockers.push('No authorization evidence recorded');
  if (permittedChannels(record, pilot).length === 0) {
    blockers.push('No pilot-approved channel has documented consent and contact details');
  }
  if (ledgerMatches(state, pilot.contractorId, record.email, record.phone).length > 0) blockers.push('Contact is on the suppression ledger');
  if (record.closed) blockers.push(`Record closed: ${record.closed.reason}`);
  return blockers;
}

/**
 * Why no approval or outreach may happen right now. Called immediately before
 * every approval and outreach action; there is no other path around it.
 */
export function contactBlockers(state: WorkbenchState, record: EstimateRecord, channel: Channel): string[] {
  const pilot = findPilot(state, record.pilotId);
  if (!pilot) return ['Pilot not found'];
  const blockers: string[] = [];
  if (record.eligibility.status === 'suppressed') blockers.push('Suppressed / do not contact');
  else if (record.eligibility.status === 'excluded') blockers.push('Excluded by contractor');
  else if (record.eligibility.status === 'ineligible') blockers.push(`Ineligible: ${record.eligibility.reason}`);
  else if (record.eligibility.status === 'pending_review') blockers.push('Eligibility not yet reviewed');
  if (pilot.status !== 'active') blockers.push(`Pilot is ${pilot.status}, not active`);
  if (!pilot.approvedChannels.includes(channel)) blockers.push(`${channel} is not an approved channel for this pilot`);
  else if (!permittedChannels(record, pilot).includes(channel)) blockers.push(`No documented ${channel} consent or contact detail`);
  for (const b of eligibilityBlockers(state, record)) if (!blockers.includes(b)) blockers.push(b);
  return blockers;
}

export function estimateAge(record: EstimateRecord, today: string): number {
  return daysBetween(record.estimateDate, today);
}

export const AGE_BANDS = [
  { key: 'under14', label: 'Under 14 days', min: -Infinity, max: 13 },
  { key: '14to30', label: '14–30 days', min: 14, max: 30 },
  { key: '31to45', label: '31–45 days', min: 31, max: 45 },
  { key: '46to60', label: '46–60 days', min: 46, max: 60 },
  { key: 'over60', label: 'Over 60 days', min: 61, max: Infinity },
] as const;

export function ageBand(days: number): (typeof AGE_BANDS)[number] {
  return AGE_BANDS.find((b) => days >= b.min && days <= b.max) ?? AGE_BANDS[0];
}
