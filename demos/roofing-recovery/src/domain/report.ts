import { AGE_BANDS, ageBand, dataIssues, findPilot } from './eligibility.ts';
import { contactedTouches, sequenceComplete } from './records.ts';
import {
  POSITIVE_OUTCOMES,
  REPLY_OUTCOMES,
  TIME_CATEGORIES,
  type Channel,
  type IsoDate,
  type TimeCategory,
  type WorkbenchState,
} from './types.ts';

/**
 * Every pilot figure is computed here, from recorded records, touches, handoffs,
 * imports, time entries and events. Screens and exports read this; nothing
 * keeps its own totals.
 */
export function pilotReport(state: WorkbenchState, pilotId: string, today: IsoDate) {
  const pilot = findPilot(state, pilotId);
  const records = state.records.filter((r) => r.pilotId === pilotId);
  const imports = state.imports.filter((i) => i.pilotId === pilotId);
  const touches = records.flatMap((r) => r.touches);
  const contacted = touches.filter((t) => t.status === 'contacted');
  const events = state.events.filter((e) => e.pilotId === pilotId);
  const count = (s: string) => records.filter((r) => r.eligibility.status === s).length;
  const sum = (xs: { estimateAmount: number }[]) => xs.reduce((a, r) => a + r.estimateAmount, 0);

  const repliedRecords = records.filter((r) => contactedTouches(r).some((t) => t.outcome && REPLY_OUTCOMES.has(t.outcome)));
  const positiveRecords = records.filter((r) => contactedTouches(r).some((t) => t.outcome && POSITIVE_OUTCOMES.has(t.outcome)));
  const qualified = records.filter((r) => r.qualification);
  const handoffs = records.filter((r) => r.handoff);
  const acknowledged = handoffs.filter((r) => r.handoff!.acknowledgedOn);
  const appointments = handoffs.filter((r) => r.handoff!.outcome === 'appointment_reported' || r.handoff!.outcome === 'job_won_verified');
  const won = handoffs.filter((r) => r.handoff!.outcome === 'job_won_verified');

  const byChannel = (['email', 'phone', 'sms'] as Channel[]).map((c) => ({ channel: c, attempts: contacted.filter((t) => t.channel === c).length }));

  const time = state.timeEntries.filter((t) => t.pilotId === pilotId);
  const minutes = (basis: 'measured' | 'estimated', cat?: TimeCategory) =>
    time.filter((t) => t.basis === basis && (!cat || t.category === cat)).reduce((a, t) => a + t.minutes, 0);
  const measuredMinutes = minutes('measured');
  const estimatedMinutes = minutes('estimated');
  const totalMinutes = measuredMinutes + estimatedMinutes;
  const hourlyCost = pilot?.hourlyCost ?? 0;
  const laborCost = (totalMinutes / 60) * hourlyCost;
  const expenses = state.expenses.filter((e) => e.pilotId === pilotId).reduce((a, e) => a + e.amount, 0);
  const totalCost = laborCost + expenses;
  const revenue = pilot?.revenue ?? 0;
  // Denominator from the recorded history: every record that was ever marked eligible.
  const everEligibleIds = new Set(events.filter((e) => e.type === 'eligibility_changed' && e.to === 'eligible' && e.recordId).map((e) => e.recordId!));
  const eligibleEver = records.filter((r) => r.eligibility.status === 'eligible' || everEligibleIds.has(r.id)).length;

  return {
    pilot,
    asOf: today,
    dataQuality: {
      rowsInFiles: imports.reduce((a, i) => a + i.rows, 0),
      imported: records.length,
      duplicates: imports.reduce((a, i) => a + i.duplicatesSkipped + i.duplicatesUpdated + i.inFileDuplicates + i.conflictsSkipped, 0),
      duplicatesUpdated: imports.reduce((a, i) => a + i.duplicatesUpdated, 0),
      conflicts: imports.reduce((a, i) => a + i.conflictsSkipped, 0),
      invalidRows: imports.reduce((a, i) => a + i.invalid, 0),
      skippedByOperator: imports.reduce((a, i) => a + i.excludedByOperator, 0),
      withDataIssues: records.filter((r) => dataIssues(r, today).some((i) => i.level === 'error')).length,
      awaitingReview: count('pending_review'),
      eligible: count('eligible'),
      ineligible: count('ineligible'),
      excluded: count('excluded'),
      suppressed: count('suppressed'),
    },
    activity: {
      draftsPrepared: touches.length,
      awaitingApproval: touches.filter((t) => t.status === 'awaiting_approval').length,
      draftsApproved: touches.filter((t) => t.approvedAt !== null).length,
      approvedNotContacted: touches.filter((t) => t.status === 'approved').length,
      blocked: touches.filter((t) => t.status === 'blocked').length,
      outreachCompleted: contacted.length,
      recordsContacted: records.filter((r) => contactedTouches(r).length > 0).length,
      byChannel,
      repliesReceived: repliedRecords.length,
    },
    outcomes: {
      positiveResponses: positiveRecords.length,
      qualified: qualified.length,
      handoffs: handoffs.length,
      acknowledged: acknowledged.length,
      appointmentsReported: appointments.length,
      jobsWonVerified: won.length,
      reportedJobValue: won.reduce((a, r) => a + (r.handoff!.reportedJobValue ?? 0), 0),
      optOuts: events.filter((e) => e.type === 'opt_out_recorded').length,
      notInterested: contacted.filter((t) => t.outcome === 'not_interested').length,
      wrongContact: contacted.filter((t) => t.outcome === 'wrong_contact').length,
      sequenceCompleteNoResponse: pilot ? records.filter((r) => sequenceComplete(r, pilot)).length : 0,
    },
    /** Estimate values of records at each stage. Potential only — never revenue. */
    estimateValue: {
      eligible: sum(records.filter((r) => r.eligibility.status === 'eligible')),
      contacted: sum(records.filter((r) => contactedTouches(r).length > 0)),
      qualified: sum(qualified),
    },
    ageBands: AGE_BANDS.map((b) => {
      const inBand = records.filter((r) => ageBand(r.ageAtImport).key === b.key);
      return {
        label: b.label,
        records: inBand.length,
        eligible: inBand.filter((r) => r.eligibility.status === 'eligible' || everEligibleIds.has(r.id)).length,
        contacted: inBand.filter((r) => contactedTouches(r).length > 0).length,
        replies: inBand.filter((r) => repliedRecords.includes(r)).length,
        qualified: inBand.filter((r) => r.qualification).length,
      };
    }),
    economics: {
      measuredMinutes,
      estimatedMinutes,
      totalMinutes,
      byCategory: TIME_CATEGORIES.map((c) => ({ category: c, measured: minutes('measured', c), estimated: minutes('estimated', c) })),
      minutesPerImported: records.length ? totalMinutes / records.length : null,
      minutesPerEligible: eligibleEver ? totalMinutes / eligibleEver : null,
      eligibleEver,
      hourlyCost,
      laborCost,
      expenses,
      totalCost,
      revenue,
      contribution: revenue - totalCost,
    },
  };
}

export type PilotReport = ReturnType<typeof pilotReport>;
