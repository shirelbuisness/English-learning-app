import { parseCsv, toCsv } from './csv.ts';
import { daysBetween, isIsoDate } from './dates.ts';
import { findPilot, ledgerMatches } from './eligibility.ts';
import { normalizeConsent, normalizeEmail, normalizePhone, normalizeYesNo } from './normalize.ts';
import { applySuppression, setEligibilityStatus } from './records.ts';
import { fail, transact, type Tx } from './state.ts';
import type {
  Authorization,
  Clock,
  EligibilityStatus,
  EstimateRecord,
  EstimateStatus,
  Pilot,
  Result,
  WorkbenchState,
} from './types.ts';

/* ------------------------------------------------------------------ template */

export const TEMPLATE_COLUMNS = [
  'customer_name',
  'customer_email',
  'customer_phone',
  'estimate_date',
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
] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly TemplateColumn[] = ['customer_name', 'estimate_date', 'estimate_amount'];

export const COLUMN_HELP: Record<TemplateColumn, string> = {
  customer_name: 'Required. Homeowner name.',
  customer_email: 'Email address. Normalised to lower case.',
  customer_phone: 'US phone number, any format. Normalised to +1XXXXXXXXXX.',
  estimate_date: 'Required. YYYY-MM-DD.',
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

export function templateCsv(): string {
  return toCsv(TEMPLATE_COLUMNS, [
    [
      'Sample Homeowner',
      'sample.homeowner@example.com',
      '(512) 555-0199',
      '2026-10-01',
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
    ],
  ]);
}

/* ------------------------------------------------------------------ analysis */

export type ImportAction = 'import' | 'skip' | 'update';

export interface ParsedRow {
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
  | { kind: 'duplicate'; recordId: string; recordName: string; on: ('email' | 'phone')[] }
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

function parseRow(get: (c: TemplateColumn) => string, today: string): { parsed: ParsedRow | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const c of TEMPLATE_COLUMNS) if (get(c).length > MAX_FIELD) errors.push(`${c} is longer than ${MAX_FIELD} characters`);

  const customerName = get('customer_name');
  if (!customerName) errors.push('customer_name is required');

  const estimateDate = get('estimate_date');
  if (!estimateDate) errors.push('estimate_date is required');
  else if (!isIsoDate(estimateDate)) errors.push(`estimate_date "${estimateDate}" must be YYYY-MM-DD`);
  else if (estimateDate > today) errors.push('estimate_date is in the future');

  const amountRaw = get('estimate_amount').replace(/[$,\s]/g, '');
  const estimateAmount = Number(amountRaw);
  if (amountRaw === '') errors.push('estimate_amount is required');
  else if (!Number.isFinite(estimateAmount) || estimateAmount < 0 || estimateAmount > 5_000_000) errors.push(`estimate_amount "${get('estimate_amount')}" is not a valid dollar amount`);

  const lastContact = get('last_contact_date');
  if (lastContact && !isIsoDate(lastContact)) errors.push(`last_contact_date "${lastContact}" must be YYYY-MM-DD or blank`);
  else if (lastContact && lastContact > today) errors.push('last_contact_date is in the future');
  else if (!lastContact) warnings.push('Last contact date missing');

  const countRaw = get('previous_follow_up_count') || '0';
  const previousFollowUps = Number(countRaw);
  if (!Number.isInteger(previousFollowUps) || previousFollowUps < 0 || previousFollowUps > 100) errors.push(`previous_follow_up_count "${countRaw}" must be a whole number`);

  const email = normalizeEmail(get('customer_email'));
  const phone = normalizePhone(get('customer_phone'));
  if (email.invalid) warnings.push(`Email "${get('customer_email')}" is not valid — ignored`);
  if (phone.invalid) warnings.push(`Phone "${get('customer_phone')}" is not a valid US number — ignored`);
  if (!email.value && !phone.value) warnings.push('No usable email or phone — cannot be contacted');

  const status = parseStatus(get('estimate_status'));
  if (!status.recognised) warnings.push(`estimate_status "${get('estimate_status')}" not recognised — treated as unknown`);
  else if (status.value === 'unknown') warnings.push('Estimate status unknown');

  const consents = (['email_consent', 'phone_consent', 'sms_consent'] as const).map((c) => {
    const n = normalizeConsent(get(c));
    if (!n.recognised) warnings.push(`${c} "${get(c)}" not recognised — treated as unknown (no permission)`);
    return n.value;
  });
  const [emailConsent = 'unknown', phoneConsent = 'unknown', smsConsent = 'unknown'] = consents;
  if (consents.every((c) => c === 'unknown')) warnings.push('Communication authorization unknown — outreach blocked until reviewed');
  const evidence = get('authorization_evidence');
  if (!evidence) warnings.push('No authorization evidence — outreach blocked until reviewed');

  const optOut = normalizeYesNo(get('prior_opt_out'));
  if (optOut === null) errors.push(`prior_opt_out "${get('prior_opt_out')}" must be yes or no`);
  const exclude = normalizeYesNo(get('contractor_exclude'));
  if (exclude === null) errors.push(`contractor_exclude "${get('contractor_exclude')}" must be yes or no`);

  if (errors.length > 0) return { parsed: null, errors, warnings };
  return {
    parsed: {
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

function diffRecord(existing: EstimateRecord, row: ParsedRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const cmp = (field: string, label: string, a: unknown, b: unknown, updatable: boolean) => {
    if (show(a) !== show(b)) diffs.push({ field, label, existing: show(a), incoming: show(b), updatable });
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
    missingOptionalColumns: [],
  };
  if (!pilot) return { ...base, fatal: ['Select a pilot before importing.'] };
  if (pilot.status === 'completed') return { ...base, fatal: ['This pilot is completed; imports are closed.'] };
  if (text.length > MAX_BYTES) return { ...base, fatal: ['File is larger than 1 MB.'] };
  if (text.includes('\u0000')) return { ...base, fatal: ['This does not look like a text CSV file.'] };

  const table = parseCsv(text.replace(/^﻿/, ''));
  const header = table[0]?.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!header) return { ...base, fatal: ['The file is empty.'] };
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) return { ...base, fatal: [`Missing required column(s): ${missing.join(', ')}. Download the template for the expected format.`] };
  if (!header.includes('customer_email') && !header.includes('customer_phone')) {
    return { ...base, fatal: ['The file needs a customer_email or customer_phone column.'] };
  }
  const dupHeaders = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupHeaders.length > 0) return { ...base, fatal: [`Duplicate column(s): ${[...new Set(dupHeaders)].join(', ')}.`] };
  const body = table.slice(1);
  if (body.length === 0) return { ...base, fatal: ['The file has a header but no rows.'] };
  if (body.length > MAX_ROWS) return { ...base, fatal: [`Too many rows (${body.length}); the limit is ${MAX_ROWS}.`] };

  const known = new Set<string>(TEMPLATE_COLUMNS);
  const unknownColumns = header.filter((h) => !known.has(h));
  const missingOptionalColumns = TEMPLATE_COLUMNS.filter((c) => !header.includes(c));

  const byEmail = new Map<string, EstimateRecord[]>();
  const byPhone = new Map<string, EstimateRecord[]>();
  for (const r of existing) {
    if (r.email) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
    if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r]);
  }
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();

  const rows: RowAnalysis[] = body.map((cells, i) => {
    const rowNumber = i + 2;
    const original: Record<string, string> = {};
    header.forEach((h, j) => (original[h] = cells[j] ?? ''));
    const get = (c: TemplateColumn) => (original[c] ?? '').trim();
    const { parsed, errors, warnings } = parseRow(get, today);
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

    // 1. Duplicates within the file (exact normalised email or phone).
    const earlier = (p.email && seenEmail.get(p.email)) || (p.phone && seenPhone.get(p.phone));
    if (earlier) {
      result.match = { kind: 'in_file_duplicate', ofRow: earlier };
      return result;
    }
    if (p.email) seenEmail.set(p.email, rowNumber);
    if (p.phone) seenPhone.set(p.phone, rowNumber);

    // 2. Existing records in this pilot.
    const emailHits = p.email ? (byEmail.get(p.email) ?? []) : [];
    const phoneHits = p.phone ? (byPhone.get(p.phone) ?? []) : [];
    const ids = [...new Set([...emailHits, ...phoneHits].map((r) => r.id))];
    if (ids.length > 1) {
      result.match = {
        kind: 'conflict',
        recordIds: ids,
        explanation: 'Email and phone match different existing records. Resolve manually; the row cannot be imported automatically.',
      };
      return result;
    }
    if (ids.length === 1) {
      const rec = existing.find((r) => r.id === ids[0])!;
      const on: ('email' | 'phone')[] = [];
      if (emailHits.length) on.push('email');
      if (phoneHits.length) on.push('phone');
      result.match = { kind: 'duplicate', recordId: rec.id, recordName: rec.customerName, on };
      result.differences = diffRecord(rec, p);
      result.allowed = result.differences.some((d) => d.updatable) ? ['skip', 'update'] : ['skip'];
      return result;
    }

    // 3. New record.
    result.ledgerSuppressed = ledgerMatches(state, pilot.contractorId, p.email, p.phone).length > 0;
    result.initialEligibility = initialEligibility(p, result.ledgerSuppressed).status;
    if (result.ledgerSuppressed) result.warnings.unshift('On the suppression ledger — will be imported as suppressed');
    const age = daysBetween(p.estimateDate, today);
    if (age < 14 || age > 60) result.warnings.push(`Estimate is ${age} days old — outside the 14–60 day test window`);
    result.allowed = ['import', 'skip'];
    result.defaultAction = 'import';
    return result;
  });

  return { ...base, rows, unknownColumns, missingOptionalColumns };
}

/* -------------------------------------------------------------------- commit */

function newRecord(tx: Tx, pilot: Pilot, importId: string, row: RowAnalysis, p: ParsedRow): EstimateRecord {
  const elig = initialEligibility(p, row.ledgerSuppressed);
  return {
    id: tx.id('rec'),
    pilotId: pilot.id,
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
  } else if ((p.estimateStatus === 'sold' || p.estimateStatus === 'lost') && (rec.eligibility.status === 'eligible' || rec.eligibility.status === 'pending_review')) {
    setEligibilityStatus(tx, rec, 'ineligible', `Estimate ${p.estimateStatus} (re-import)`, 'import');
  }
}
