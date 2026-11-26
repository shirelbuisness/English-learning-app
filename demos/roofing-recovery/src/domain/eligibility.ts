import { daysBetween } from './dates.ts';
import type { Channel, Consent, ContactMode, EstimateRecord, Pilot, SuppressionEntry, WorkbenchState } from './types.ts';

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

/** Normalised estimate reference: trimmed, upper case, single spaces. */
export function normalizeRef(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return v === '' ? null : v;
}

export interface ContactKeys {
  email: string | null;
  phone: string | null;
  estimateRef?: string | null;
}

/** Active suppression-ledger entries for this contractor matching the email, phone or estimate reference. */
export function ledgerMatches(state: WorkbenchState, contractorId: string, who: ContactKeys): SuppressionEntry[] {
  const ref = normalizeRef(who.estimateRef);
  return state.suppression.filter(
    (e) =>
      e.active &&
      e.contractorId === contractorId &&
      ((who.email && e.email === who.email) || (who.phone && e.phone === who.phone) || (ref && normalizeRef(e.estimateRef) === ref)),
  );
}

/** True when two records refer to the same homeowner/estimate (exact email, phone or estimate reference). */
export function sameContact(a: ContactKeys, b: ContactKeys): boolean {
  const ra = normalizeRef(a.estimateRef);
  return Boolean((a.email && a.email === b.email) || (a.phone && a.phone === b.phone) || (ra && ra === normalizeRef(b.estimateRef)));
}

const consentFor = (record: EstimateRecord, channel: Channel): Consent =>
  channel === 'email' ? record.authorization.emailConsent : channel === 'phone' ? record.authorization.phoneConsent : record.authorization.smsConsent;

/**
 * Channels this record may be contacted on.
 * - in_workbench: pilot-approved, contact detail present here and documented per-contact consent.
 * - contractor_system: pilot-approved and covered by the contractor's recorded attestation; an
 *   explicit per-contact "no" still blocks. Contact details stay in the contractor's system.
 */
export function permittedChannels(record: EstimateRecord, pilot: Pilot): Channel[] {
  return pilot.approvedChannels.filter((c) => {
    const consent = consentFor(record, c);
    if (consent === 'no') return false;
    if ((pilot.contactMode ?? 'in_workbench') === 'contractor_system') return consent === 'yes' || pilot.contractorAttestation !== null;
    const hasDetail = c === 'email' ? record.email !== null : record.phone !== null;
    return hasDetail && consent === 'yes';
  });
}

/** Data-quality problems shown on review screens. */
export function dataIssues(record: EstimateRecord, today: string, mode: ContactMode = 'in_workbench'): Issue[] {
  const issues: Issue[] = [];
  const o = record.original;
  if (mode === 'contractor_system') {
    if (!record.estimateRef) issues.push({ level: 'error', message: "No estimate ID to find this homeowner in the contractor's system" });
  } else if (!record.email && !record.phone) issues.push({ level: 'error', message: 'No usable email or phone number' });
  if (!record.email && (o.customer_email ?? '').trim() !== '') issues.push({ level: 'warning', message: `Email "${o.customer_email}" is not a valid address` });
  if (!record.phone && (o.customer_phone ?? '').trim() !== '') issues.push({ level: 'warning', message: `Phone "${o.customer_phone}" is not a valid US number` });
  if (record.estimateAmount <= 0) issues.push({ level: 'warning', message: 'Estimate amount is missing or zero' });
  if (record.estimateStatus === 'unknown') issues.push({ level: 'warning', message: 'Estimate status unknown — confirm with contractor' });
  if (!record.lastContactDate) issues.push({ level: 'warning', message: 'Last contact date missing' });
  if (record.lastContactDate && record.lastContactDate > today) issues.push({ level: 'error', message: 'Last contact date is in the future' });
  if (mode === 'in_workbench') {
    if (record.authorization.evidence.trim() === '') issues.push({ level: 'error', message: 'No authorization evidence recorded' });
    const a = record.authorization;
    if (a.emailConsent === 'unknown' && a.phoneConsent === 'unknown' && a.smsConsent === 'unknown') {
      issues.push({ level: 'error', message: 'Communication authorization unknown for every channel' });
    }
  }
  if (!record.service.trim()) issues.push({ level: 'warning', message: 'Service requested is missing' });
  return issues;
}

/** Why this record cannot be marked eligible. Empty = the operator may mark it eligible. */
export function eligibilityBlockers(state: WorkbenchState, record: EstimateRecord): string[] {
  const pilot = findPilot(state, record.pilotId);
  if (!pilot) return ['Pilot not found'];
  const blockers: string[] = [];
  const privacySafe = (pilot.contactMode ?? 'in_workbench') === 'contractor_system';
  if (record.estimateStatus !== 'open') blockers.push(`Estimate status is "${record.estimateStatus}" — only open estimates can be contacted`);
  if (record.authorization.priorOptOut) blockers.push('Previous opt-out recorded');
  if (privacySafe) {
    if (!record.estimateRef) blockers.push("No estimate ID to find this homeowner in the contractor's system");
    if (!pilot.contractorAttestation && record.authorization.evidence.trim() === '') {
      blockers.push("No contractor attestation recorded for this pilot (Contractors & pilots)");
    }
    if (permittedChannels(record, pilot).length === 0) blockers.push('No pilot-approved channel is permitted for this homeowner');
  } else {
    if (!record.email && !record.phone) blockers.push('No usable contact details');
    if (record.authorization.evidence.trim() === '') blockers.push('No authorization evidence recorded');
    if (permittedChannels(record, pilot).length === 0) {
      blockers.push('No pilot-approved channel has documented consent and contact details');
    }
  }
  if (ledgerMatches(state, pilot.contractorId, record).length > 0) blockers.push('Contact is on the suppression ledger');
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
  else if (!permittedChannels(record, pilot).includes(channel)) blockers.push(`${channel} is not permitted for this homeowner`);
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
