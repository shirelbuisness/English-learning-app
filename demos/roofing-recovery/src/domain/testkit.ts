import { toCsv } from './csv.ts';
import { clockAt } from './dates.ts';
import { commitImport, TEMPLATE_COLUMNS } from './importer.ts';
import { setEligibility } from './records.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus } from './setup.ts';
import { emptyState, must } from './state.ts';
import type { EstimateRecord, WorkbenchState } from './types.ts';

/* Test helpers only. */

export const TODAY = '2026-11-24';
export const clock = clockAt(TODAY);

export type RowInput = Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string>>;

export function row(over: RowInput = {}): RowInput {
  return {
    customer_name: 'Alex Rivera',
    customer_email: 'alex.rivera@example.com',
    customer_phone: '(512) 555-0150',
    estimate_date: '2026-10-25',
    estimate_amount: '18000',
    service_requested: 'Full roof replacement',
    property_city: 'Austin',
    property_state: 'TX',
    estimate_status: 'open',
    last_contact_date: '2026-10-27',
    previous_follow_up_count: '0',
    inquiry_source: 'Website form',
    contact_info_source: 'Website form',
    email_consent: 'yes',
    phone_consent: 'yes',
    sms_consent: 'no',
    authorization_evidence: 'Consent checkbox on form',
    communication_preferences: '',
    prior_opt_out: 'no',
    contractor_exclude: 'no',
    ...over,
  };
}

export function csv(rows: RowInput[]): string {
  return toCsv(TEMPLATE_COLUMNS, rows.map((r) => TEMPLATE_COLUMNS.map((c) => r[c] ?? '')));
}

/** One contractor, one active pilot (email + phone approved). */
export function fixture(name = 'Test Roofing'): { s: WorkbenchState; contractorId: string; pilotId: string } {
  let s = must(createContractor(emptyState(), { businessName: name, primaryContact: 'Pat Owner', email: '', phone: '(512) 555-0100', timeZone: 'America/Chicago', notes: '' }, clock));
  const contractorId = s.contractors.at(-1)!.id;
  s = must(createPilot(s, contractorId, { ...defaultPilotInput(TODAY), contactMode: 'in_workbench', name: `${name} pilot`, approvedChannels: ['email', 'phone'], communicationPolicy: 'Approved', endDate: '2026-12-31' }, clock));
  const pilotId = s.pilots.at(-1)!.id;
  s = must(setPilotStatus(s, pilotId, 'active', clock));
  return { s, contractorId, pilotId };
}

export function addPilot(s: WorkbenchState, contractorId: string, name: string): { s: WorkbenchState; pilotId: string } {
  let n = must(createPilot(s, contractorId, { ...defaultPilotInput(TODAY), contactMode: 'in_workbench', name, approvedChannels: ['email', 'phone'], communicationPolicy: 'Approved', endDate: '2026-12-31' }, clock));
  const pilotId = n.pilots.at(-1)!.id;
  n = must(setPilotStatus(n, pilotId, 'active', clock));
  return { s: n, pilotId };
}

export function importRows(s: WorkbenchState, pilotId: string, rows: RowInput[], decisions = {}): WorkbenchState {
  return must(commitImport(s, pilotId, csv(rows), 'test.csv', decisions, clock));
}

export function rec(s: WorkbenchState, name: string, pilotId?: string): EstimateRecord {
  const r = s.records.find((x) => x.customerName === name && (!pilotId || x.pilotId === pilotId));
  if (!r) throw new Error(`no record ${name}`);
  return r;
}

export function eligible(s: WorkbenchState, name: string): WorkbenchState {
  return must(setEligibility(s, rec(s, name).id, 'eligible', '', clock));
}
