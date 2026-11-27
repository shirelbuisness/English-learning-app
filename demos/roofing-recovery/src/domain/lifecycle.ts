import { toCsv } from './csv.ts';
import { formatDate } from './dates.ts';
import { prioritize, PRIORITY_LABELS } from './priority.ts';
import { pilotReport, type PilotReport } from './report.ts';
import { workflowStatus, WORKFLOW_LABELS } from './queue.ts';
import { fail, transact } from './state.ts';
import {
  ELIGIBILITY_SHORT,
  HANDOFF_OUTCOME_LABELS,
  OUTCOME_LABELS,
  TIME_CATEGORY_LABELS,
  type Clock,
  type Result,
  type WorkbenchState,
} from './types.ts';

/* ------------------------------------------------------------- clear pilot */

export function clearPilotPreview(state: WorkbenchState, pilotId: string) {
  const records = state.records.filter((r) => r.pilotId === pilotId);
  return {
    records: records.length,
    touches: records.reduce((a, r) => a + r.touches.length, 0),
    handoffs: records.filter((r) => r.handoff).length,
    imports: state.imports.filter((i) => i.pilotId === pilotId).length,
    timeEntries: state.timeEntries.filter((t) => t.pilotId === pilotId).length,
    expenses: state.expenses.filter((e) => e.pilotId === pilotId).length,
    events: state.events.filter((e) => e.pilotId === pilotId).length,
    ledgerEntriesKept: state.suppression.filter((s) => s.pilotId === pilotId).length,
  };
}

/**
 * Delete one pilot and its operational data. Requires the pilot name typed
 * as a second confirmation. The contractor's suppression ledger is kept, so a
 * re-import into a new pilot cannot re-enable a suppressed contact.
 */
export function clearPilot(state: WorkbenchState, pilotId: string, typedName: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const pilot = tx.s.pilots.find((p) => p.id === pilotId) ?? fail('Select a pilot to clear.');
    if (typedName.trim() !== pilot.name) fail('Type the pilot name exactly to confirm.');
    const counts = clearPilotPreview(tx.s, pilotId);
    tx.s.records = tx.s.records.filter((r) => r.pilotId !== pilotId);
    tx.s.imports = tx.s.imports.filter((i) => i.pilotId !== pilotId);
    tx.s.timeEntries = tx.s.timeEntries.filter((t) => t.pilotId !== pilotId);
    tx.s.expenses = tx.s.expenses.filter((e) => e.pilotId !== pilotId);
    tx.s.events = tx.s.events.filter((e) => e.pilotId !== pilotId);
    tx.s.pilots = tx.s.pilots.filter((p) => p.id !== pilotId);
    // Ledger entries stay; drop the link to the deleted record but keep the contact keys.
    for (const s of tx.s.suppression) if (s.pilotId === pilotId) s.recordId = null;
    const summary = `${counts.records} records, ${counts.touches} drafts/contacts, ${counts.handoffs} handoffs, ${counts.timeEntries} time entries, ${counts.expenses} expenses, ${counts.events} history events deleted; ${counts.ledgerEntriesKept} suppression entries kept`;
    tx.log({ type: 'pilot_cleared', contractorId: pilot.contractorId, detail: `Pilot "${pilot.name}" (${pilotId}) cleared: ${summary}` });
    return `Cleared "${pilot.name}": ${summary}.`;
  });
}

/* ------------------------------------------------------------- demo reset */

/** Remove all demo contractors and everything that belongs to them. Non-demo data is untouched. */
export function stripDemo(state: WorkbenchState): WorkbenchState {
  const demoContractors = new Set(state.contractors.filter((c) => c.isDemo).map((c) => c.id));
  const demoPilots = new Set(state.pilots.filter((p) => p.isDemo || demoContractors.has(p.contractorId)).map((p) => p.id));
  return {
    ...state,
    contractors: state.contractors.filter((c) => !demoContractors.has(c.id)),
    pilots: state.pilots.filter((p) => !demoPilots.has(p.id)),
    records: state.records.filter((r) => !demoPilots.has(r.pilotId)),
    suppression: state.suppression.filter((s) => !demoContractors.has(s.contractorId)),
    imports: state.imports.filter((i) => !demoPilots.has(i.pilotId)),
    timeEntries: state.timeEntries.filter((t) => !demoPilots.has(t.pilotId)),
    expenses: state.expenses.filter((e) => !demoPilots.has(e.pilotId)),
    events: state.events.filter((e) => !(e.pilotId && demoPilots.has(e.pilotId)) && !(e.contractorId && demoContractors.has(e.contractorId))),
  };
}

/* ----------------------------------------------------------------- export */

export const EXPORT_FORMAT = 'roofing-recovery-pilot-export';

/** Complete, readable JSON export of one pilot (documented in the README). */
export function pilotExport(state: WorkbenchState, pilotId: string, clock: Clock) {
  const pilot = state.pilots.find((p) => p.id === pilotId);
  if (!pilot) return null;
  return {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    exportedAt: clock.now,
    syntheticDataOnly: true,
    contractor: state.contractors.find((c) => c.id === pilot.contractorId) ?? null,
    pilot,
    records: state.records.filter((r) => r.pilotId === pilotId),
    imports: state.imports.filter((i) => i.pilotId === pilotId),
    timeEntries: state.timeEntries.filter((t) => t.pilotId === pilotId),
    expenses: state.expenses.filter((e) => e.pilotId === pilotId),
    events: state.events.filter((e) => e.pilotId === pilotId),
    suppressionLedger: state.suppression.filter((s) => s.contractorId === pilot.contractorId),
    report: pilotReport(state, pilotId, clock.today),
  };
}

export function recordsCsv(state: WorkbenchState, pilotId: string, today: string): string {
  const rows = state.records
    .filter((r) => r.pilotId === pilotId)
    .map((r) => {
      const last = r.touches.filter((t) => t.status === 'contacted').at(-1);
      return [
        r.id,
        r.customerName,
        r.email,
        r.phone,
        r.city,
        r.state,
        r.estimateDate,
        r.ageAtImport,
        r.estimateAmount,
        r.service,
        r.estimateStatus,
        ELIGIBILITY_SHORT[r.eligibility.status],
        r.eligibility.reason,
        PRIORITY_LABELS[prioritize(state, r, today).category],
        WORKFLOW_LABELS[workflowStatus(state, r)],
        r.touches.length,
        r.touches.filter((t) => t.status === 'contacted').length,
        last?.outcome ? OUTCOME_LABELS[last.outcome] : '',
        r.qualification ? 'yes' : 'no',
        r.handoff ? 'yes' : 'no',
        r.handoff?.acknowledgedOn ?? '',
        r.handoff?.outcome ? HANDOFF_OUTCOME_LABELS[r.handoff.outcome] : '',
        r.closed?.reason ?? '',
      ];
    });
  return toCsv(
    [
      'record_id',
      'customer_name',
      'email',
      'phone',
      'city',
      'state',
      'estimate_date',
      'age_at_import_days',
      'estimate_amount',
      'service',
      'estimate_status',
      'eligibility',
      'eligibility_reason',
      'priority',
      'workflow_status',
      'drafts_prepared',
      'contacts_completed',
      'latest_outcome',
      'qualified_reengagement',
      'handoff_created',
      'contractor_acknowledged_on',
      'handoff_outcome',
      'closed_reason',
    ],
    rows,
  );
}

export function eventsCsv(state: WorkbenchState, pilotId: string): string {
  return toCsv(
    ['timestamp', 'event', 'record_id', 'from', 'to', 'detail'],
    state.events.filter((e) => e.pilotId === pilotId).map((e) => [e.at, e.type, e.recordId, e.from, e.to, e.detail]),
  );
}

export function timeCsv(state: WorkbenchState, pilotId: string): string {
  return toCsv(
    ['date', 'category', 'minutes', 'basis', 'notes'],
    state.timeEntries.filter((t) => t.pilotId === pilotId).map((t) => [t.date, TIME_CATEGORY_LABELS[t.category], t.minutes, t.basis, t.notes]),
  );
}

export function reportCsv(report: PilotReport): string {
  const r = report;
  const e = r.economics;
  const rows: [string, string, string | number][] = [
    ['Pilot', 'Name', r.pilot?.name ?? ''],
    ['Pilot', 'Report date', formatDate(r.asOf)],
    ['Pilot', 'Data', 'Synthetic demonstration data — not actual results'],
    ['Data quality', 'Rows in imported files', r.dataQuality.rowsInFiles],
    ['Data quality', 'Records imported', r.dataQuality.imported],
    ['Data quality', 'Duplicate rows detected', r.dataQuality.duplicates],
    ['Data quality', 'Invalid rows', r.dataQuality.invalidRows],
    ['Data quality', 'Excluded by contractor', r.dataQuality.excluded],
    ['Data quality', 'Suppressed', r.dataQuality.suppressed],
    ['Data quality', 'Ineligible', r.dataQuality.ineligible],
    ['Data quality', 'Awaiting review', r.dataQuality.awaitingReview],
    ['Data quality', 'Eligible', r.dataQuality.eligible],
    ['Activity', 'Drafts prepared', r.activity.draftsPrepared],
    ['Activity', 'Drafts approved by contractor', r.activity.draftsApproved],
    ['Activity', 'Approved, not yet contacted', r.activity.approvedNotContacted],
    ['Activity', 'Blocked drafts', r.activity.blocked],
    ['Activity', 'Outreach attempts completed (operator-confirmed)', r.activity.outreachCompleted],
    ['Activity', 'Homeowners replied', r.activity.repliesReceived],
    ['Outcomes', 'Positive responses', r.outcomes.positiveResponses],
    ['Outcomes', 'Qualified re-engagements', r.outcomes.qualified],
    ['Outcomes', 'Warm handoffs', r.outcomes.handoffs],
    ['Outcomes', 'Contractor acknowledgements', r.outcomes.acknowledged],
    ['Outcomes', 'Appointments / inspections reported by contractor', r.outcomes.appointmentsReported],
    ['Outcomes', 'Jobs won (contractor-verified)', r.outcomes.jobsWonVerified],
    ['Outcomes', 'Opt-outs', r.outcomes.optOuts],
    ['Economics', 'Measured operator minutes', e.measuredMinutes],
    ['Economics', 'Estimated operator minutes', e.estimatedMinutes],
    ['Economics', 'Hourly cost assumption (USD)', e.hourlyCost],
    ['Economics', 'Labor cost (USD)', e.laborCost.toFixed(2)],
    ['Economics', 'Additional expenses (USD)', e.expenses.toFixed(2)],
    ['Economics', 'Total estimated delivery cost (USD)', e.totalCost.toFixed(2)],
    ['Economics', 'Pilot revenue (USD, entered)', e.revenue.toFixed(2)],
    ['Economics', 'Contribution before taxes and overhead (USD)', e.contribution.toFixed(2)],
    ...e.byCategory.map((c) => ['Time by category', TIME_CATEGORY_LABELS[c.category], `${c.measured} measured / ${c.estimated} estimated min`] as [string, string, string]),
  ];
  return toCsv(['section', 'metric', 'value'], rows);
}

export function logExport(state: WorkbenchState, pilotId: string, what: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const p = tx.s.pilots.find((x) => x.id === pilotId) ?? fail('Pilot not found.');
    tx.log({ type: 'data_exported', pilotId, contractorId: p.contractorId, detail: `Exported ${what}` });
    return `Exported ${what}.`;
  });
}
