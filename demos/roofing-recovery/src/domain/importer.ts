import { parseCsv, toCsv } from './csv.ts';
import { addDays, daysBetween, isIsoDate } from './dates.ts';
import { findPilot, ledgerMatches, normalizeRef } from './eligibility.ts';
import { normalizeConsent, normalizeEmail, normalizePhone, normalizeYesNo } from './normalize.ts';
import { applySuppression, setEligibilityStatus } from './records.ts';
import { fail, transact, type Tx } from './state.ts';
import type {
  Authorization,
  Clock,
  ContactMode,
  EligibilityStatus,
  EstimateRecord,
  EstimateStatus,
  Pilot,
  Result,
  WorkbenchState,
} from './types.ts';

/* ------------------------------------------------------------------ template */

export const TEMPLATE_COLUMNS = [
  'estimate_ref',
  'customer_name',
  'customer_email',
  'customer_phone',
  'estimate_date',
  'days_since_sent',
  'estimate_amount',
  'service_requested',
  'property_city',
  'property_state',
  'estimate_status',
  'last_contact_date',
  'previous_follow_up_count',
  'inquiry_source',
  'contact_info_source',
  'email_consent',
  'phone_consent',
  'sms_consent',
  'authorization_evidence',
  'communication_preferences',
  'prior_opt_out',
  'contractor_exclude',
  'notes',
] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

/** Always required. A date column is also required: estimate_date or days_since_sent. */
export const REQUIRED_COLUMNS: readonly TemplateColumn[] = ['customer_name', 'estimate_amount'];

/**
 * Forgiving header matching for real CRM/spreadsheet exports. Headers are compared after
 * lower-casing and removing everything except letters and digits ("Quote #" → "quote").
 */
const HEADER_ALIASES: Record<TemplateColumn, string[]> = {
  estimate_ref: ['estimateref', 'estimateid', 'estimate', 'estimateno', 'estimatenumber', 'quoteid', 'quote', 'quoteno', 'quotenumber', 'jobid', 'jobno', 'jobnumber', 'proposalid', 'proposal', 'ref', 'reference', 'id'],
  customer_name: ['customername', 'firstname', 'first', 'name', 'customer', 'client', 'clientname', 'homeowner', 'homeownername', 'contact', 'contactname'],
  customer_email: ['customeremail', 'email', 'emailaddress', 'contactemail', 'homeowneremail'],
  customer_phone: ['customerphone', 'phone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'contactphone', 'homeownerphone'],
  estimate_date: ['estimatedate', 'datesent', 'sentdate', 'sent', 'quotedate', 'proposaldate', 'created', 'createddate', 'datecreated', 'date'],
  days_since_sent: ['dayssincesent', 'daysold', 'age', 'agedays', 'daysopen', 'days', 'dayssinceestimate', 'daysout'],
  estimate_amount: ['estimateamount', 'amount', 'quoteamount', 'quotevalue', 'quote_total', 'total', 'estimatetotal', 'value', 'price', 'jobvalue', 'contractamount'],
  service_requested: ['servicerequested', 'service', 'scope', 'roofscope', 'jobtype', 'description', 'workdescription', 'project', 'jobdescription'],
  property_city: ['propertycity', 'city', 'town'],
  property_state: ['propertystate', 'state', 'st'],
  estimate_status: ['estimatestatus', 'status', 'quotestatus', 'stage'],
  last_contact_date: ['lastcontactdate', 'lastcontact', 'lastcontacted', 'lastfollowup', 'lasttouch'],
  previous_follow_up_count: ['previousfollowupcount', 'followups', 'followupcount', 'touches', 'attempts'],
  inquiry_source: ['inquirysource', 'source', 'leadsource', 'referralsource'],
  contact_info_source: ['contactinfosource'],
  email_consent: ['emailconsent', 'emailoptin', 'okemail'],
  phone_consent: ['phoneconsent', 'callconsent', 'okcall', 'okphone'],
  sms_consent: ['smsconsent', 'textconsent', 'smsoptin', 'textoptin', 'oktext'],
  authorization_evidence: ['authorizationevidence', 'consentevidence', 'consentnotes'],
  communication_preferences: ['communicationpreferences', 'preferences', 'contactpreference', 'preferredcontact'],
  prior_opt_out: ['prioroptout', 'optout', 'optedout', 'donotcontact', 'dnc', 'unsubscribed'],
  contractor_exclude: ['contractorexclude', 'exclude', 'skip', 'donotfollowup'],
  notes: ['notes', 'note', 'comments', 'comment', 'statusnotes', 'internalnotes', 'remarks'],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS_LOOKUP = new Map<string, TemplateColumn>();
for (const col of TEMPLATE_COLUMNS) {
  ALIAS_LOOKUP.set(headerKey(col), col);
  for (const a of HEADER_ALIASES[col]) if (!ALIAS_LOOKUP.has(headerKey(a))) ALIAS_LOOKUP.set(headerKey(a), col);
}

/** Map one header cell to a template column, or null if unrecognised. */
export function mapHeader(h: string): TemplateColumn | null {
  return ALIAS_LOOKUP.get(headerKey(h)) ?? null;
}

/** Homeowner contact columns: never stored in a privacy-safe pilot. */
const CONTACT_COLUMNS: ReadonlySet<string> = new Set(['customer_email', 'customer_phone']);

/** Accepts YYYY-MM-DD, M/D/YYYY and M/D/YY (US exports). Returns an ISO date or null. */
export function parseFlexibleDate(raw: string): string | null {
  const v = raw.trim();
  if (isIsoDate(v)) return v;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(v);
  if (!us) return null;
  const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
  const iso = `${year}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

export const COLUMN_HELP: Record<TemplateColumn, string> = {
  estimate_ref: "Recommended. The contractor's estimate/quote number, used to find the homeowner in their CRM or inbox and to spot duplicates.",
  days_since_sent: 'Alternative to estimate_date: how many days ago the estimate was sent.',
  notes: 'Context from the contractor, e.g. "Waiting on adjuster", "Getting 2nd bid".',
  customer_name: 'Required. Homeowner first name is enough.',
  customer_email: 'Email address. Normalised to lower case.',
  customer_phone: 'US phone number, any format. Normalised to +1XXXXXXXXXX.',
  estimate_date: 'YYYY-MM-DD or MM/DD/YYYY. Either this or days_since_sent is required.',
  estimate_amount: 'Required. Dollars, e.g. 18400 or $18,400.',
  service_requested: 'E.g. Full roof replacement.',
  property_city: 'City.',
  property_state: 'Two-letter state, e.g. TX.',
  estimate_status: 'open, sold, lost or unknown.',
  last_contact_date: 'YYYY-MM-DD, blank if unknown.',
  previous_follow_up_count: 'Whole number; blank = 0.',
  inquiry_source: 'Original lead source, if known.',
  contact_info_source: 'Where the contact details came from.',
  email_consent: 'yes / no / unknown. Blank = unknown. Unknown never counts as permission.',
  phone_consent: 'yes / no / unknown (calls).',
  sms_consent: 'yes / no / unknown (text messages).',
  authorization_evidence: 'Description of the consent evidence (form, date, recording …).',
  communication_preferences: 'E.g. "Email only, after 5pm".',
  prior_opt_out: 'yes / no. "yes" suppresses the contact.',
  contractor_exclude: 'yes / no. "yes" excludes the record at the contractor\'s request.',
};

/** The privacy-safe minimal format: no phone, email or street address. */
export const SAMPLE_CSV_COLUMNS = ['Estimate ID', 'First Name', 'Roof Scope', 'Quote Amount', 'Days Since Sent', 'Notes'] as const;

export function sampleEstimatesCsv(): string {
  return toCsv(SAMPLE_CSV_COLUMNS, [
    ['Q-1042', 'Sarah', 'Full replacement, architectural shingles', '$18,400', '21', 'Waiting on adjuster'],
    ['Q-1047', 'Mike', 'Full replacement + metal accent over porch', '$22,000', '30', 'Getting 2nd bid'],
    ['Q-1051', 'Linda', 'Hail claim, full replacement', '$14,900', '16', 'Husband/wife deciding'],
  ]);
}

export function templateCsv(): string {
  return toCsv(TEMPLATE_COLUMNS, [
    [
      'Q-1001',
      'Sample Homeowner',
      'sample.homeowner@example.com',
      '(512) 555-0199',
      '2026-10-01',
      '',
      '14500',
      'Full roof replacement',
      'Austin',
      'TX',
      'open',
      '2026-10-03',
      '1',
      'Website form',
      'Website estimate request form',
      'yes',
      'yes',
      'unknown',
      'Consent checkbox on estimate request form, 2026-09-28',
      'Prefers email',
      'no',
      'no',
      'Waiting on adjuster',
    ],
  ]);
}

/* ------------------------------------------------------------------ analysis */

export type ImportAction = 'import' | 'skip' | 'update';

export interface ParsedRow {
  estimateRef: string | null;
  notes: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  estimateDate: string;
  estimateAmount: number;
  service: string;
  city: string;
  state: string;
  estimateStatus: EstimateStatus;
  lastContactDate: string | null;
  previousFollowUps: number;
  inquirySource: string;
  authorization: Authorization;
  contractorExclude: boolean;
}

export interface FieldDiff {
  field: string;
  label: string;
  existing: string;
  incoming: string;
  /** Updatable estimate details; others are shown but require manual review to change. */
  updatable: boolean;
}

export type Match =
  | { kind: 'new' }
  | { kind: 'duplicate'; recordId: string; recordName: string; on: ('estimate ID' | 'email' | 'phone')[] }
  | { kind: 'conflict'; recordIds: string[]; explanation: string }
  | { kind: 'in_file_duplicate'; ofRow: number };

export interface RowAnalysis {
  rowNumber: number;
  original: Record<string, string>;
  parsed: ParsedRow | null;
  errors: string[];
  warnings: string[];
  match: Match;
  ledgerSuppressed: boolean;
  initialEligibility: EligibilityStatus | null;
  differences: FieldDiff[];
  allowed: ImportAction[];
  defaultAction: ImportAction;
}

export interface ImportAnalysis {
  fatal: string[];
  rows: RowAnalysis[];
  existingCount: number;
  recordLimit: number;
  unknownColumns: string[];
  /** Privacy-safe pilots: columns present in the file that were deliberately not imported. */
  droppedColumns: string[];
  missingOptionalColumns: string[];
}

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 1000;
const MAX_FIELD = 300;

function parseStatus(raw: string): { value: EstimateStatus; recognised: boolean } {
  const v = raw.trim().toLowerCase();
  if (v === '') return { value: 'unknown', recognised: true };
  if (['open', 'unsold', 'pending', 'sent', 'estimate sent'].includes(v)) return { value: 'open', recognised: true };
  if (['sold', 'won', 'booked', 'closed won'].includes(v)) return { value: 'sold', recognised: true };
  if (['lost', 'closed lost', 'declined', 'dead'].includes(v)) return { value: 'lost', recognised: true };
  if (v === 'unknown') return { value: 'unknown', recognised: true };
  return { value: 'unknown', recognised: false };
}

function parseRow(
  get: (c: TemplateColumn) => string,
  today: string,
  mode: ContactMode,
  has: (c: TemplateColumn) => boolean,
): { parsed: ParsedRow | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const c of TEMPLATE_COLUMNS) if (get(c).length > MAX_FIELD) errors.push(`${c} is longer than ${MAX_FIELD} characters`);

  const customerName = get('customer_name');
  if (!customerName) errors.push('customer_name is required');

  let estimateDate = '';
  const rawDate = get('estimate_date');
  const rawDays = get('days_since_sent');
  if (rawDate) {
    const d = parseFlexibleDate(rawDate);
    if (!d) errors.push(`estimate_date "${rawDate}" must be YYYY-MM-DD or MM/DD/YYYY`);
    else if (d > today) errors.push('estimate_date is in the future');
    else estimateDate = d;
  } else if (rawDays) {
    const n = Number(rawDays.replace(/days?/i, '').trim());
    if (!Number.isInteger(n) || n < 0 || n > 3650) errors.push(`days_since_sent "${rawDays}" must be a whole number of days`);
    else estimateDate = addDays(today, -n);
  } else errors.push('estimate date is required (estimate_date or days_since_sent)');

  const amountRaw = get('estimate_amount').replace(/[$,\s]/g, '');
  const estimateAmount = Number(amountRaw);
  if (amountRaw === '') errors.push('estimate_amount is required');
  else if (!Number.isFinite(estimateAmount) || estimateAmount < 0 || estimateAmount > 5_000_000) errors.push(`estimate_amount "${get('estimate_amount')}" is not a valid dollar amount`);

  const rawLast = get('last_contact_date');
  const lastContact = rawLast ? parseFlexibleDate(rawLast) : null;
  if (rawLast && !lastContact) errors.push(`last_contact_date "${rawLast}" must be YYYY-MM-DD, MM/DD/YYYY or blank`);
  else if (lastContact && lastContact > today) errors.push('last_contact_date is in the future');
  else if (!lastContact && has('last_contact_date')) warnings.push('Last contact date missing');

  const countRaw = get('previous_follow_up_count') || '0';
  const previousFollowUps = Number(countRaw);
  if (!Number.isInteger(previousFollowUps) || previousFollowUps < 0 || previousFollowUps > 100) errors.push(`previous_follow_up_count "${countRaw}" must be a whole number`);

  const email = normalizeEmail(get('customer_email'));
  const phone = normalizePhone(get('customer_phone'));
  if (email.invalid) warnings.push(`Email "${get('customer_email')}" is not valid — ignored`);
  if (phone.invalid) warnings.push(`Phone "${get('customer_phone')}" is not a valid US number — ignored`);
  const estimateRef = normalizeRef(get('estimate_ref'));
  if (mode === 'contractor_system') {
    if (!estimateRef) warnings.push("No estimate ID — the homeowner can't be found in the contractor's system and duplicates can't be detected");
  } else if (!email.value && !phone.value) warnings.push('No usable email or phone — cannot be contacted');

  // A stale-quote list from the contractor is a list of unsold estimates. If the file has no
  // status column at all, treat rows as open; a blank or unknown value in a status column needs review.
  const status = has('estimate_status') ? parseStatus(get('estimate_status')) : { value: 'open' as EstimateStatus, recognised: true };
  if (!status.recognised) warnings.push(`estimate_status "${get('estimate_status')}" not recognised — treated as unknown`);
  else if (status.value === 'unknown') warnings.push('Estimate status unknown');

  const consents = (['email_consent', 'phone_consent', 'sms_consent'] as const).map((c) => {
    const n = normalizeConsent(get(c));
    if (!n.recognised) warnings.push(`${c} "${get(c)}" not recognised — treated as unknown (no permission)`);
    return n.value;
  });
  const [emailConsent = 'unknown', phoneConsent = 'unknown', smsConsent = 'unknown'] = consents;
  const evidence = get('authorization_evidence');
  if (mode === 'in_workbench') {
    if (consents.every((c) => c === 'unknown')) warnings.push('Communication authorization unknown — outreach blocked until reviewed');
    if (!evidence) warnings.push('No authorization evidence — outreach blocked until reviewed');
  }

  const optOut = normalizeYesNo(get('prior_opt_out'));
  if (optOut === null) errors.push(`prior_opt_out "${get('prior_opt_out')}" must be yes or no`);
  const exclude = normalizeYesNo(get('contractor_exclude'));
  if (exclude === null) errors.push(`contractor_exclude "${get('contractor_exclude')}" must be yes or no`);

  if (errors.length > 0) return { parsed: null, errors, warnings };
  return {
    parsed: {
      estimateRef,
      notes: get('notes'),
      customerName,
      email: email.value,
      phone: phone.value,
      estimateDate,
      estimateAmount: Math.round(estimateAmount * 100) / 100,
      service: get('service_requested'),
      city: get('property_city'),
      state: get('property_state').toUpperCase(),
      estimateStatus: status.value,
      lastContactDate: lastContact || null,
      previousFollowUps,
      inquirySource: get('inquiry_source'),
      authorization: {
        emailConsent,
        phoneConsent,
        smsConsent,
        evidence,
        contactInfoSource: get('contact_info_source'),
        preferences: get('communication_preferences'),
        priorOptOut: optOut === true,
      },
      contractorExclude: exclude === true,
    },
    errors,
    warnings,
  };
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Which record field each template column fills. A field is only compared/updated when its column has a value. */
const FIELD_COLUMN: Record<string, TemplateColumn> = {
  customerName: 'customer_name',
  email: 'customer_email',
  phone: 'customer_phone',
  estimateDate: 'estimate_date',
  estimateAmount: 'estimate_amount',
  service: 'service_requested',
  city: 'property_city',
  state: 'property_state',
  estimateStatus: 'estimate_status',
  lastContactDate: 'last_contact_date',
  previousFollowUps: 'previous_follow_up_count',
  inquirySource: 'inquiry_source',
  emailConsent: 'email_consent',
  phoneConsent: 'phone_consent',
  smsConsent: 'sms_consent',
  evidence: 'authorization_evidence',
  notes: 'notes',
};

function diffRecord(existing: EstimateRecord, row: ParsedRow, original: Record<string, string>): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  // Missing columns or blank cells never overwrite existing data.
  const provided = (field: string) => (original[FIELD_COLUMN[field]!] ?? '').trim() !== '';
  const cmp = (field: string, label: string, a: unknown, b: unknown, updatable: boolean) => {
    if (provided(field) && show(a) !== show(b)) diffs.push({ field, label, existing: show(a), incoming: show(b), updatable });
  };
  cmp('customerName', 'Name', existing.customerName, row.customerName, false);
  cmp('email', 'Email', existing.email, row.email, false);
  cmp('phone', 'Phone', existing.phone, row.phone, false);
  cmp('estimateDate', 'Estimate date', existing.estimateDate, row.estimateDate, false);
  cmp('estimateAmount', 'Estimate amount', existing.estimateAmount, row.estimateAmount, true);
  cmp('service', 'Service', existing.service, row.service, true);
  cmp('city', 'City', existing.city, row.city, true);
  cmp('state', 'State', existing.state, row.state, true);
  cmp('estimateStatus', 'Estimate status', existing.estimateStatus, row.estimateStatus, true);
  cmp('lastContactDate', 'Last contact', existing.lastContactDate, row.lastContactDate, true);
  cmp('previousFollowUps', 'Previous follow-ups', existing.previousFollowUps, row.previousFollowUps, true);
  cmp('inquirySource', 'Inquiry source', existing.inquirySource, row.inquirySource, false);
  cmp('notes', 'Notes', existing.notes, row.notes, true);
  const ea = existing.authorization;
  const ra = row.authorization;
  cmp('emailConsent', 'Email consent', ea.emailConsent, ra.emailConsent, false);
  cmp('phoneConsent', 'Phone consent', ea.phoneConsent, ra.phoneConsent, false);
  cmp('smsConsent', 'SMS consent', ea.smsConsent, ra.smsConsent, false);
  cmp('evidence', 'Authorization evidence', ea.evidence, ra.evidence, false);
  // Restrictions from the import (opt-out, exclusion) may only tighten; applied by "update".
  if (row.authorization.priorOptOut && existing.eligibility.status !== 'suppressed') {
    diffs.push({ field: 'priorOptOut', label: 'Prior opt-out', existing: 'no', incoming: 'yes — will suppress', updatable: true });
  }
  if (row.contractorExclude && existing.eligibility.status !== 'excluded' && existing.eligibility.status !== 'suppressed') {
    diffs.push({ field: 'contractorExclude', label: 'Contractor exclusion', existing: 'no', incoming: 'yes — will exclude', updatable: true });
  }
  return diffs;
}

function initialEligibility(row: ParsedRow, ledger: boolean): { status: EligibilityStatus; reason: string; source: EstimateRecord['eligibility']['source'] } {
  if (ledger) return { status: 'suppressed', reason: 'Contact matches the contractor suppression ledger', source: 'ledger' };
  if (row.authorization.priorOptOut) return { status: 'suppressed', reason: 'Previous opt-out recorded in import', source: 'import' };
  if (row.contractorExclude) return { status: 'excluded', reason: 'Marked for exclusion by contractor in import', source: 'contractor' };
  if (row.estimateStatus === 'sold' || row.estimateStatus === 'lost') return { status: 'ineligible', reason: `Estimate already ${row.estimateStatus}`, source: 'import' };
  return { status: 'pending_review', reason: 'Imported — eligibility and authorization need review', source: 'import' };
}

/** Preview an import. Never throws; malformed input produces `fatal` messages. */
export function analyzeImport(state: WorkbenchState, pilotId: string, text: string, today: string): ImportAnalysis {
  const pilot = findPilot(state, pilotId);
  const existing = state.records.filter((r) => r.pilotId === pilotId);
  const base: ImportAnalysis = {
    fatal: [],
    rows: [],
    existingCount: existing.length,
    recordLimit: pilot?.recordLimit ?? 0,
    unknownColumns: [],
    droppedColumns: [],
    missingOptionalColumns: [],
  };
  if (!pilot) return { ...base, fatal: ['Select a pilot before importing.'] };
  if (pilot.status === 'completed') return { ...base, fatal: ['This pilot is completed; imports are closed.'] };
  if (text.length > MAX_BYTES) return { ...base, fatal: ['File is larger than 1 MB.'] };
  if (text.includes('\u0000')) return { ...base, fatal: ['This does not look like a text CSV file.'] };

  const table = parseCsv(text.replace(/^﻿/, ''));
  const rawHeader = table[0]?.map((h) => h.trim());
  if (!rawHeader) return { ...base, fatal: ['The file is empty.'] };
  // Forgiving header mapping: "Quote #", "First Name", "Total" … → template columns.
  const header = rawHeader.map((h) => mapHeader(h) ?? h);
  const mappedFrom = new Map<string, string[]>();
  rawHeader.forEach((h, i) => mappedFrom.set(header[i]!, [...(mappedFrom.get(header[i]!) ?? []), h]));
  const clashes = [...mappedFrom.entries()].filter(([, raws]) => raws.length > 1);
  if (clashes.length > 0) {
    return { ...base, fatal: clashes.map(([col, raws]) => `Columns ${raws.map((r) => `"${r}"`).join(' and ')} both look like ${col}. Rename or remove one.`) };
  }
  const has = (c: TemplateColumn) => header.includes(c);
  const missing: string[] = REQUIRED_COLUMNS.filter((c) => !has(c));
  if (!has('estimate_date') && !has('days_since_sent')) missing.push('estimate_date or days_since_sent');
  if (missing.length > 0) {
    return { ...base, fatal: [`Missing required column(s): ${missing.join(', ')}. Columns found: ${rawHeader.join(', ') || 'none'}. Download the sample file for the expected format.`] };
  }
  if (!has('estimate_ref') && !has('customer_email') && !has('customer_phone')) {
    return { ...base, fatal: ['The file needs an estimate ID column (e.g. "Estimate ID", "Quote #") or an email/phone column, so each homeowner can be identified.'] };
  }
  const body = table.slice(1);
  if (body.length === 0) return { ...base, fatal: ['The file has a header but no rows.'] };
  if (body.length > MAX_ROWS) return { ...base, fatal: [`Too many rows (${body.length}); the limit is ${MAX_ROWS}.`] };

  const known = new Set<string>(TEMPLATE_COLUMNS);
  const unknownColumns = header.filter((h) => !known.has(h));
  // Columns that are only relevant when contact details are kept here are not "missing" in privacy-safe mode.
  const relevant = TEMPLATE_COLUMNS.filter((c) =>
    pilot.contactMode === 'contractor_system'
      ? !['customer_email', 'customer_phone', 'email_consent', 'phone_consent', 'sms_consent', 'authorization_evidence', 'contact_info_source', 'estimate_date', 'days_since_sent'].includes(c)
      : !['estimate_date', 'days_since_sent'].includes(c),
  );
  const missingOptionalColumns = relevant.filter((c) => !has(c));

  const byEmail = new Map<string, EstimateRecord[]>();
  const byPhone = new Map<string, EstimateRecord[]>();
  const byRef = new Map<string, EstimateRecord[]>();
  for (const r of existing) {
    if (r.email) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
    if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r]);
    const ref = normalizeRef(r.estimateRef);
    if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), r]);
  }
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenRef = new Map<string, number>();
  const mode: ContactMode = pilot.contactMode ?? 'in_workbench';

  const rows: RowAnalysis[] = body.map((cells, i) => {
    const rowNumber = i + 2;
    const original: Record<string, string> = {};
    // Privacy-safe pilots keep nothing beyond the recognised job columns: no contact details,
    // no unrecognised columns (they might hold last names, addresses or notes about people).
    header.forEach((h, j) => {
      if (mode === 'contractor_system' && (!known.has(h) || CONTACT_COLUMNS.has(h))) return;
      original[h] = cells[j] ?? '';
    });
    const get = (c: TemplateColumn) => (original[c] ?? '').trim();
    const { parsed, errors, warnings } = parseRow(get, today, mode, has);
    if (cells.length !== header.length) errors.unshift(`Expected ${header.length} fields, found ${cells.length}`);

    const result: RowAnalysis = {
      rowNumber,
      original,
      parsed: errors.length ? null : parsed,
      errors,
      warnings,
      match: { kind: 'new' },
      ledgerSuppressed: false,
      initialEligibility: null,
      differences: [],
      allowed: ['skip'],
      defaultAction: 'skip',
    };
    if (!result.parsed) return result;
    const p = result.parsed;

    // 1. Duplicates within the file (exact estimate ID, normalised email or phone).
    const earlier = (p.estimateRef && seenRef.get(p.estimateRef)) || (p.email && seenEmail.get(p.email)) || (p.phone && seenPhone.get(p.phone));
    if (earlier) {
      result.match = { kind: 'in_file_duplicate', ofRow: earlier };
      return result;
    }
    if (p.estimateRef) seenRef.set(p.estimateRef, rowNumber);
    if (p.email) seenEmail.set(p.email, rowNumber);
    if (p.phone) seenPhone.set(p.phone, rowNumber);

    // 2. Existing records in this pilot.
    const refHits = p.estimateRef ? (byRef.get(p.estimateRef) ?? []) : [];
    const emailHits = p.email ? (byEmail.get(p.email) ?? []) : [];
    const phoneHits = p.phone ? (byPhone.get(p.phone) ?? []) : [];
    const ids = [...new Set([...refHits, ...emailHits, ...phoneHits].map((r) => r.id))];
    if (ids.length > 1) {
      result.match = {
        kind: 'conflict',
        recordIds: ids,
        explanation: 'Estimate ID, email and phone point to different existing records. Resolve manually; the row cannot be imported automatically.',
      };
      return result;
    }
    if (ids.length === 1) {
      const rec = existing.find((r) => r.id === ids[0])!;
      const on: ('estimate ID' | 'email' | 'phone')[] = [];
      if (refHits.length) on.push('estimate ID');
      if (emailHits.length) on.push('email');
      if (phoneHits.length) on.push('phone');
      result.match = { kind: 'duplicate', recordId: rec.id, recordName: rec.customerName, on };
      result.differences = diffRecord(rec, p, original);
      result.allowed = result.differences.some((d) => d.updatable) ? ['skip', 'update'] : ['skip'];
      return result;
    }

    // 3. New record.
    result.ledgerSuppressed = ledgerMatches(state, pilot.contractorId, p).length > 0;
    result.initialEligibility = initialEligibility(p, result.ledgerSuppressed).status;
    if (result.ledgerSuppressed) result.warnings.unshift('On the suppression ledger — will be imported as suppressed');
    const age = daysBetween(p.estimateDate, today);
    if (age < 14 || age > 60) result.warnings.push(`Estimate is ${age} days old — outside the 14–60 day test window`);
    result.allowed = ['import', 'skip'];
    result.defaultAction = 'import';
    return result;
  });

  const droppedColumns = mode === 'contractor_system' ? rawHeader.filter((_, i) => !known.has(header[i]!) || CONTACT_COLUMNS.has(header[i]!)) : [];
  return { ...base, rows, unknownColumns: mode === 'contractor_system' ? [] : unknownColumns, droppedColumns, missingOptionalColumns };
}

/* -------------------------------------------------------------------- commit */

function newRecord(tx: Tx, pilot: Pilot, importId: string, row: RowAnalysis, p: ParsedRow): EstimateRecord {
  const elig = initialEligibility(p, row.ledgerSuppressed);
  return {
    id: tx.id('rec'),
    pilotId: pilot.id,
    estimateRef: p.estimateRef,
    notes: p.notes,
    importId,
    rowNumber: row.rowNumber,
    original: { ...row.original },
    customerName: p.customerName,
    email: p.email,
    phone: p.phone,
    estimateDate: p.estimateDate,
    estimateAmount: p.estimateAmount,
    service: p.service,
    city: p.city,
    state: p.state,
    estimateStatus: p.estimateStatus,
    lastContactDate: p.lastContactDate,
    previousFollowUps: p.previousFollowUps,
    inquirySource: p.inquirySource,
    ageAtImport: daysBetween(p.estimateDate, tx.clock.today),
    authorization: { ...p.authorization },
    eligibility: { ...elig, decidedAt: tx.clock.now },
    touches: [],
    qualification: null,
    handoff: null,
    closed: null,
    version: 1,
    createdAt: tx.clock.now,
    updatedAt: tx.clock.now,
  };
}

/**
 * Commit an import. The file is re-analysed against the current state, every
 * decision is checked against what that row allows, and the whole import is
 * applied in one transaction.
 */
export function commitImport(
  state: WorkbenchState,
  pilotId: string,
  text: string,
  fileName: string,
  decisions: Record<number, ImportAction>,
  clock: Clock,
): Result {
  return transact(state, clock, (tx) => {
    const analysis = analyzeImport(tx.s, pilotId, text, clock.today);
    if (analysis.fatal.length > 0) fail(analysis.fatal.join(' '));
    const pilot = findPilot(tx.s, pilotId)!;
    const actionFor = (r: RowAnalysis) => decisions[r.rowNumber] ?? r.defaultAction;
    for (const r of analysis.rows) {
      const a = actionFor(r);
      if (!r.allowed.includes(a)) fail(`Row ${r.rowNumber}: "${a}" is not allowed for this row.`);
    }
    const toImport = analysis.rows.filter((r) => actionFor(r) === 'import');
    if (analysis.existingCount + toImport.length > pilot.recordLimit) {
      fail(`Importing ${toImport.length} records would exceed the pilot limit of ${pilot.recordLimit} (currently ${analysis.existingCount}). Exclude some rows.`);
    }

    const importId = tx.id('imp');
    const ctx = { pilotId, contractorId: pilot.contractorId };
    const batch = {
      id: importId,
      pilotId,
      fileName: fileName || 'pasted.csv',
      importedAt: clock.now,
      rows: analysis.rows.length,
      imported: 0,
      duplicatesSkipped: 0,
      duplicatesUpdated: 0,
      conflictsSkipped: 0,
      inFileDuplicates: 0,
      invalid: 0,
      excludedByOperator: 0,
      suppressedOnImport: 0,
    };

    for (const r of analysis.rows) {
      const action = actionFor(r);
      if (!r.parsed) {
        batch.invalid++;
        continue;
      }
      switch (r.match.kind) {
        case 'in_file_duplicate':
          batch.inFileDuplicates++;
          tx.log({ type: 'import_row_skipped', ...ctx, detail: `Row ${r.rowNumber}: duplicate of row ${r.match.ofRow} in the same file` });
          break;
        case 'conflict':
          batch.conflictsSkipped++;
          tx.log({ type: 'import_conflict', ...ctx, detail: `Row ${r.rowNumber}: email and phone match different records (${r.match.recordIds.join(', ')}) — skipped for manual review` });
          break;
        case 'duplicate': {
          const rec = tx.s.records.find((x) => x.id === (r.match as { recordId: string }).recordId)!;
          if (action === 'skip') {
            batch.duplicatesSkipped++;
            tx.log({ type: 'duplicate_skipped', ...ctx, recordId: rec.id, detail: `Row ${r.rowNumber}: matches existing record; kept existing${r.differences.length ? ` (${r.differences.length} differing field(s) not applied)` : ''}` });
          } else {
            applyDuplicateUpdate(tx, rec, r);
            batch.duplicatesUpdated++;
          }
          break;
        }
        case 'new': {
          if (action === 'skip') {
            batch.excludedByOperator++;
            tx.log({ type: 'import_row_skipped', ...ctx, detail: `Row ${r.rowNumber}: excluded from import by operator` });
            break;
          }
          const rec = newRecord(tx, pilot, importId, r, r.parsed);
          tx.s.records.push(rec);
          batch.imported++;
          tx.log({ type: 'record_imported', ...ctx, recordId: rec.id, to: rec.eligibility.status, detail: `Imported from ${batch.fileName} row ${r.rowNumber}` });
          if (rec.eligibility.status === 'suppressed') {
            batch.suppressedOnImport++;
            tx.log({ type: 'eligibility_changed', ...ctx, recordId: rec.id, to: 'suppressed', detail: rec.eligibility.reason });
            // Opt-out reported in the file: add it to the contractor ledger too.
            if (!r.ledgerSuppressed) applySuppression(tx, rec, rec.eligibility.reason, 'import', clock.today, 'import');
          }
          break;
        }
      }
    }
    tx.s.imports.push(batch);
    tx.log({
      type: 'import_completed',
      ...ctx,
      detail: `${batch.fileName}: ${batch.rows} rows · ${batch.imported} imported · ${batch.duplicatesSkipped + batch.duplicatesUpdated + batch.inFileDuplicates + batch.conflictsSkipped} duplicates · ${batch.invalid} invalid · ${batch.excludedByOperator} excluded`,
    });
    return `Import complete: ${batch.imported} new, ${batch.duplicatesUpdated} updated, ${batch.duplicatesSkipped + batch.inFileDuplicates + batch.conflictsSkipped} duplicates skipped, ${batch.invalid} invalid.`;
  });
}

/** Apply only updatable estimate details and restriction tightening. Never touches history, eligibility loosening or authorization. */
function applyDuplicateUpdate(tx: Tx, rec: EstimateRecord, row: RowAnalysis): void {
  const p = row.parsed!;
  const pilot = findPilot(tx.s, rec.pilotId)!;
  const ctx = { pilotId: rec.pilotId, contractorId: pilot.contractorId, recordId: rec.id };
  const applied: string[] = [];
  for (const d of row.differences.filter((x) => x.updatable)) {
    switch (d.field) {
      case 'estimateAmount':
        rec.estimateAmount = p.estimateAmount;
        break;
      case 'service':
        rec.service = p.service;
        break;
      case 'city':
        rec.city = p.city;
        break;
      case 'state':
        rec.state = p.state;
        break;
      case 'estimateStatus':
        rec.estimateStatus = p.estimateStatus;
        break;
      case 'lastContactDate':
        rec.lastContactDate = p.lastContactDate;
        break;
      case 'previousFollowUps':
        rec.previousFollowUps = p.previousFollowUps;
        break;
      case 'notes':
        rec.notes = p.notes;
        break;
      default:
        continue;
    }
    applied.push(`${d.label}: ${d.existing} → ${d.incoming}`);
  }
  if (applied.length) {
    rec.version += 1;
    rec.updatedAt = tx.clock.now;
    tx.log({ type: 'duplicate_updated', ...ctx, detail: `Row ${row.rowNumber} applied: ${applied.join('; ')}` });
  }
  if (row.differences.some((d) => d.field === 'priorOptOut')) {
    applySuppression(tx, rec, 'Previous opt-out reported in re-import', 'import', tx.clock.today, 'import');
  } else if (row.differences.some((d) => d.field === 'contractorExclude')) {
    setEligibilityStatus(tx, rec, 'excluded', 'Excluded by contractor in re-import', 'contractor');
  } else if (!applied.some((a) => a.startsWith('Estimate status'))) {
    // no status change
  } else if ((p.estimateStatus === 'sold' || p.estimateStatus === 'lost') && (rec.eligibility.status === 'eligible' || rec.eligibility.status === 'pending_review')) {
    setEligibilityStatus(tx, rec, 'ineligible', `Estimate ${p.estimateStatus} (re-import)`, 'import');
  } else if (p.estimateStatus !== 'open' && rec.eligibility.status === 'eligible') {
    setEligibilityStatus(tx, rec, 'pending_review', `Estimate status changed to ${p.estimateStatus} (re-import) — review required`, 'import');
  }
}
