import { isIsoDate } from './dates.ts';
import { LEAD_STATUSES, STATUS_LABELS, type IsoDate, type Lead, type LeadStatus } from './types.ts';
import { newFollowUp } from './workflow.ts';

export const CSV_COLUMNS = [
  'name',
  'city',
  'source',
  'received_date',
  'service',
  'estimate_value',
  'status',
  'last_contact_date',
  'follow_up_count',
] as const;

export const CSV_MAX_ROWS = 200;

export const CSV_EXAMPLE =
  `${CSV_COLUMNS.join(',')}\n` +
  'Sample Customer,"Killeen, TX",Website form,2026-11-12,Roof leak repair,1450,new_inquiry,,0\n';

export type CsvImportResult = { ok: true; leads: Lead[] } | { ok: false; errors: string[] };

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseStatus(raw: string): LeadStatus | null {
  const v = raw.trim().toLowerCase();
  const byKey = LEAD_STATUSES.find((s) => s === v.replace(/[\s-]+/g, '_'));
  if (byKey) return byKey;
  return LEAD_STATUSES.find((s) => STATUS_LABELS[s].toLowerCase() === v) ?? null;
}

/**
 * Validate and convert a CSV of leads. The whole file is rejected if any row
 * is invalid, so a partial import never happens.
 */
export function importLeadsCsv(text: string, existingIds: ReadonlySet<string>, asOf: IsoDate): CsvImportResult {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (!header) return { ok: false, errors: ['The file is empty.'] };

  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) return { ok: false, errors: [`Missing required column(s): ${missing.join(', ')}.`] };

  const body = rows.slice(1);
  if (body.length === 0) return { ok: false, errors: ['The file has a header but no lead rows.'] };
  if (body.length > CSV_MAX_ROWS) return { ok: false, errors: [`Too many rows (${body.length}). The limit is ${CSV_MAX_ROWS}.`] };

  const col = (row: string[], name: (typeof CSV_COLUMNS)[number]) => (row[header.indexOf(name)] ?? '').trim();
  const errors: string[] = [];
  const leads: Lead[] = [];
  let seq = 1;
  const nextId = () => {
    let id: string;
    do id = `IMP-${String(seq++).padStart(3, '0')}`;
    while (existingIds.has(id));
    return id;
  };

  body.forEach((row, i) => {
    const line = i + 2;
    const rowErrors: string[] = [];
    if (row.length !== header.length) rowErrors.push(`expected ${header.length} fields, found ${row.length}`);

    const name = col(row, 'name');
    const city = col(row, 'city');
    const source = col(row, 'source');
    const service = col(row, 'service');
    const received = col(row, 'received_date');
    const lastContact = col(row, 'last_contact_date');
    const valueRaw = col(row, 'estimate_value').replace(/[$,\s]/g, '');
    const countRaw = col(row, 'follow_up_count') || '0';
    const status = parseStatus(col(row, 'status'));

    for (const [label, v] of [['name', name], ['city', city], ['source', source], ['service', service]] as const) {
      if (!v) rowErrors.push(`${label} is required`);
      else if (v.length > 120) rowErrors.push(`${label} is longer than 120 characters`);
    }
    if (!isIsoDate(received)) rowErrors.push(`received_date "${received}" must be YYYY-MM-DD`);
    else if (received > asOf) rowErrors.push('received_date is in the future');
    if (lastContact && !isIsoDate(lastContact)) rowErrors.push(`last_contact_date "${lastContact}" must be YYYY-MM-DD or empty`);
    else if (lastContact && isIsoDate(received) && lastContact < received) rowErrors.push('last_contact_date is before received_date');
    else if (lastContact > asOf) rowErrors.push('last_contact_date is in the future');
    const value = Number(valueRaw);
    if (valueRaw === '' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      rowErrors.push(`estimate_value "${col(row, 'estimate_value')}" must be a dollar amount between 0 and 1,000,000`);
    }
    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 0 || count > 50) rowErrors.push(`follow_up_count "${countRaw}" must be a whole number from 0 to 50`);
    if (!status) rowErrors.push(`status "${col(row, 'status')}" must be one of: ${LEAD_STATUSES.join(', ')}`);

    if (rowErrors.length > 0 || !status) {
      errors.push(`Row ${line}: ${rowErrors.join('; ')}.`);
      return;
    }
    leads.push({
      id: nextId(),
      name,
      city,
      source,
      receivedDate: received,
      service,
      estimateValue: Math.round(value),
      status,
      lastContactDate: lastContact || null,
      followUpCount: count,
      phone: '—',
      email: '—',
      history: [{ date: received, channel: 'web form', direction: 'inbound', summary: 'Imported from CSV.' }],
      followUp: newFollowUp(),
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, leads };
}
