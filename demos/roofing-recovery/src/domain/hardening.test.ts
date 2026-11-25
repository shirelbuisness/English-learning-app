import { describe, expect, it } from 'vitest';
import { withDemoData } from '../data/demoSeed.ts';
import { BACKUP_KEY, createLocalStore, REVISION_KEY, STORAGE_KEY } from '../storage/localStore.ts';
import { buildQueue } from './queue.ts';
import {
  acknowledgeHandoff,
  approveDrafts,
  confirmContact,
  createHandoff,
  editDraft,
  markHandoffNotified,
  openTouch,
  prepareDraft,
  qualifyReengagement,
  recordHandoffOutcome,
  recordResponse,
  reverseLedgerEntry,
  reviewRestriction,
  setEligibility,
  submitForApproval,
  suppressRecord,
} from './records.ts';
import { pilotReport } from './report.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus } from './setup.ts';
import { emptyState, must } from './state.ts';
import type { Outcome, WorkbenchState } from './types.ts';
import { commitImport } from './importer.ts';
import { addPilot, clock, csv, eligible, fixture, importRows, rec, row, TODAY } from './testkit.ts';

function memStore() {
  const mem = new Map<string, string>();
  return { mem, storage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
}

/** Eligible Alex Rivera with an approved step-1 email. */
function approved() {
  const f = fixture();
  let s = eligible(importRows(f.s, f.pilotId, [row()]), 'Alex Rivera');
  s = must(prepareDraft(s, rec(s, 'Alex Rivera').id, clock));
  const t = openTouch(rec(s, 'Alex Rivera'))!.id;
  s = must(submitForApproval(s, [t], clock));
  s = must(approveDrafts(s, [t], clock));
  return { ...f, s, t };
}
const contact = (s: WorkbenchState, t: string, outcome: Outcome) =>
  confirmContact(s, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome, notes: '' }, clock);

describe('persistence: concurrent tabs and malformed data', () => {
  it('refuses to overwrite a newer save from another tab', () => {
    const { mem, storage } = memStore();
    const tabA = createLocalStore(storage);
    const tabB = createLocalStore(storage);
    const s = withDemoData(emptyState(), TODAY);
    expect(tabA.save(s, 0)).toEqual({ ok: true, revision: 1 });
    const bView = tabB.load();
    const aChanged = { ...s, nextId: s.nextId + 10 };
    expect(tabA.save(aChanged, 1)).toEqual({ ok: true, revision: 2 });
    // Tab B still thinks the revision is 1.
    expect(tabB.save({ ...bView.state!, nextId: 1 }, bView.revision)).toEqual({ ok: false, reason: 'conflict' });
    expect(JSON.parse(mem.get(STORAGE_KEY)!).nextId).toBe(aChanged.nextId);
    expect(mem.get(REVISION_KEY)).toBe('2');
  });

  it.each([
    ['bad eligibility', (x: any) => (x.records[0].eligibility.status = 'maybe')],
    ['message without status', (x: any) => delete x.records.find((r: any) => r.touches.length).touches[0].status],
    ['pilot without sequence', (x: any) => delete x.pilots[0].sequence],
    ['ledger entry without flag', (x: any) => delete x.suppression[0].active],
    ['schema version', (x: any) => (x.schemaVersion = 3)],
  ])('rejects stored data with %s and keeps a backup', (_name, corrupt) => {
    const { mem, storage } = memStore();
    const s = JSON.parse(JSON.stringify(withDemoData(emptyState(), TODAY)));
    corrupt(s);
    mem.set(STORAGE_KEY, JSON.stringify(s));
    const r = createLocalStore(storage).load();
    expect(r.state).toBeNull();
    expect(r.error).toMatch(/could not be read/);
    expect(mem.get(BACKUP_KEY)).toBe(JSON.stringify(s));
  });
});

describe('suppression ledger', () => {
  it('propagates within one contractor only', () => {
    const { s, pilotId } = fixture('Alpha');
    let n = importRows(s, pilotId, [row()]);
    n = must(createContractor(n, { businessName: 'Beta', primaryContact: 'B', email: '', phone: '', timeZone: 'America/Chicago', notes: '' }, clock));
    const beta = n.contractors.at(-1)!.id;
    n = must(createPilot(n, beta, { ...defaultPilotInput(TODAY), name: 'Beta pilot', communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    const bp = n.pilots.at(-1)!.id;
    n = importRows(n, bp, [row()]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera', pilotId).id, { reason: 'opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    expect(rec(n, 'Alex Rivera', bp).eligibility.status).toBe('pending_review');
  });

  it('propagation also matches on phone alone and blocks batch approval in the other pilot', () => {
    const { s, contractorId, pilotId } = fixture();
    let n = importRows(s, pilotId, [row({ customer_email: '' })]);
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'P2');
    n = importRows(s2, p2, [row({ customer_email: 'other@example.com' })]);
    const r2 = n.records.find((r) => r.pilotId === p2)!;
    n = must(setEligibility(n, r2.id, 'eligible', '', clock));
    n = must(prepareDraft(n, r2.id, clock));
    const t = openTouch(n.records.find((r) => r.id === r2.id)!)!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(suppressRecord(n, rec(n, 'Alex Rivera', pilotId).id, { reason: 'called to opt out', channel: 'phone', date: TODAY, source: 'homeowner' }, clock));
    expect(n.records.find((r) => r.id === r2.id)!.eligibility.status).toBe('suppressed');
    expect(approveDrafts(n, [t], clock).batch?.done).toEqual([]);
  });

  it('lifting a ledger entry needs a reason and does not un-suppress records', () => {
    const { s, contractorId, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'P2');
    n = importRows(s2, p2, [row()]);
    const r2 = n.records.find((r) => r.pilotId === p2)!;
    const entry = n.suppression[0]!;
    expect(reverseLedgerEntry(n, entry.id, 'short', clock).ok).toBe(false);
    n = must(reverseLedgerEntry(n, entry.id, 'Operator suppressed the wrong homeowner', clock));
    expect(n.records.every((r) => r.eligibility.status === 'suppressed')).toBe(true);
    expect(reverseLedgerEntry(n, entry.id, 'Operator suppressed the wrong homeowner', clock).ok).toBe(false);
    // Now the second record's own review can proceed — to pending review, never eligible.
    n = must(reviewRestriction(n, r2.id, 'Ledger entry was lifted after review', clock));
    expect(n.records.find((r) => r.id === r2.id)!.eligibility.status).toBe('pending_review');
    expect(n.events.some((e) => e.type === 'suppression_ledger_reversed')).toBe(true);
  });
});

describe('approval stays tied to the record it was approved against', () => {
  it('a changed record surfaces as "revise", blocks contact, and works again after re-approval', () => {
    let { s, pilotId, t } = approved();
    const before = pilotReport(s, pilotId, TODAY).activity.draftsApproved;
    s = importRows(s, pilotId, [row({ estimate_amount: '21000' })], { 2: 'update' });
    expect(buildQueue(s, TODAY).find((q) => q.touchId === t)?.kind).toBe('revise_draft');
    expect(contact(s, t, 'no_response').ok).toBe(false);
    s = must(editDraft(s, t, 'Hi Alex, following up on your updated $21,000 estimate.', clock));
    expect(rec(s, 'Alex Rivera').touches[0]).toMatchObject({ status: 'draft', approvedAt: null });
    expect(s.events.some((e) => e.type === 'approval_revoked')).toBe(true);
    expect(pilotReport(s, pilotId, TODAY).activity.draftsApproved).toBe(before - 1);
    s = must(submitForApproval(s, [t], clock));
    s = must(approveDrafts(s, [t], clock));
    expect(contact(s, t, 'no_response').ok).toBe(true);
  });

  it('submission is closed on a completed pilot', () => {
    const f = fixture();
    let s = eligible(importRows(f.s, f.pilotId, [row()]), 'Alex Rivera');
    s = must(prepareDraft(s, rec(s, 'Alex Rivera').id, clock));
    s = must(setPilotStatus(s, f.pilotId, 'completed', clock));
    expect(submitForApproval(s, [openTouch(rec(s, 'Alex Rivera'))!.id], clock).batch?.done).toEqual([]);
  });
});

describe('replies, qualification and handoffs', () => {
  it('an "Other" reply must be reclassified before it can be qualified; the ladder stays nested', () => {
    let { s, pilotId, t } = approved();
    s = must(contact(s, t, 'other'));
    const id = rec(s, 'Alex Rivera').id;
    expect(qualifyReengagement(s, id, { confirmed: true, request: 'callback', notes: '' }, clock).ok).toBe(false);
    expect(recordResponse(s, id, { outcome: 'other', date: TODAY, channel: 'email', notes: '' }, clock).ok).toBe(false);
    s = must(recordResponse(s, id, { outcome: 'callback', date: TODAY, channel: 'email', notes: 'Wants a call' }, clock));
    expect(s.events.some((e) => e.type === 'response_reclassified' && e.from === 'other' && e.to === 'callback')).toBe(true);
    s = must(qualifyReengagement(s, id, { confirmed: true, request: 'callback', notes: '' }, clock));
    const o = pilotReport(s, pilotId, TODAY);
    expect(o.outcomes.qualified).toBeLessThanOrEqual(o.outcomes.positiveResponses);
    expect(o.outcomes.positiveResponses).toBeLessThanOrEqual(o.activity.repliesReceived);
  });

  it('a reply can be reclassified as an opt-out, which suppresses the contact', () => {
    let { s, t } = approved();
    s = must(contact(s, t, 'other'));
    s = must(recordResponse(s, rec(s, 'Alex Rivera').id, { outcome: 'opted_out', date: TODAY, channel: 'email', notes: '' }, clock));
    expect(rec(s, 'Alex Rivera').eligibility.status).toBe('suppressed');
  });

  it('a restricted record with a handoff already notified can only be acknowledged/closed out', () => {
    let { s, t } = approved();
    s = must(contact(s, t, 'inspection'));
    const id = rec(s, 'Alex Rivera').id;
    s = must(qualifyReengagement(s, id, { confirmed: true, request: 'inspection', notes: '' }, clock));
    s = must(createHandoff(s, id, { respondedOn: TODAY, homeownerRequest: 'Inspection', conversationNotes: '', nextAction: 'Book' }, clock));
    // Excluded before notification: contractor must not be notified.
    const excluded = must(suppressRecord(s, id, { reason: 'Contractor: do not contact', channel: 'other', date: TODAY, source: 'contractor' }, clock));
    expect(markHandoffNotified(excluded, id, TODAY, clock).ok).toBe(false);
    expect(buildQueue(excluded, TODAY).some((q) => q.recordId === id)).toBe(false);
    // Notified first, then suppressed: acknowledgement and outcome can still be recorded.
    s = must(markHandoffNotified(s, id, TODAY, clock));
    s = must(suppressRecord(s, id, { reason: 'Homeowner opted out', channel: 'phone', date: TODAY, source: 'homeowner' }, clock));
    expect(buildQueue(s, TODAY).find((q) => q.recordId === id)?.kind).toBe('await_ack');
    s = must(acknowledgeHandoff(s, id, TODAY, '', clock));
    s = must(recordHandoffOutcome(s, id, { outcome: 'not_proceeding', date: TODAY, notes: 'Homeowner opted out', verifiedByContractor: false, jobValue: null }, clock));
    expect(rec(s, 'Alex Rivera').handoff?.outcome).toBe('not_proceeding');
  });
});

describe('demo seed robustness', () => {
  it('builds for dates across a full year, including month and year boundaries', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-03-01', '2026-12-31', '2027-01-15', '2028-02-29']) {
      expect(() => withDemoData(emptyState(), d), d).not.toThrow();
    }
  });
});

describe('report denominators come from recorded history', () => {
  it('counts a record that was eligible and later suppressed (before any draft) as having reached eligibility', () => {
    const f = fixture();
    let s = importRows(f.s, f.pilotId, [row(), row({ customer_name: 'Bo', customer_email: 'bo@example.com', customer_phone: '' })]);
    s = eligible(s, 'Alex Rivera');
    s = eligible(s, 'Bo');
    s = must(suppressRecord(s, rec(s, 'Bo').id, { reason: 'opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const r = pilotReport(s, f.pilotId, TODAY);
    expect(r.dataQuality.eligible).toBe(1); // current
    expect(r.economics.eligibleEver).toBe(2); // ever
    expect(r.outcomes.optOuts).toBe(1);
  });

  it('keeps every outcome stage nested on the demo data after further work', () => {
    const s = withDemoData(emptyState(), TODAY);
    for (const p of s.pilots) {
      const r = pilotReport(s, p.id, TODAY);
      const ladder = [r.activity.recordsContacted, r.activity.repliesReceived, r.outcomes.positiveResponses, r.outcomes.qualified, r.outcomes.handoffs, r.outcomes.acknowledged, r.outcomes.appointmentsReported, r.outcomes.jobsWonVerified];
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1]!);
      expect(r.activity.outreachCompleted).toBeLessThanOrEqual(r.activity.draftsApproved);
      expect(r.economics.totalCost).toBeCloseTo(r.economics.laborCost + r.economics.expenses);
      expect(r.economics.contribution).toBeCloseTo(r.economics.revenue - r.economics.totalCost);
    }
  });
});

describe('duplicate updates from partial files', () => {
  it('missing columns and blank cells never overwrite existing data', () => {
    const f = fixture();
    let s = eligible(importRows(f.s, f.pilotId, [row({ previous_follow_up_count: '2' })]), 'Alex Rivera');
    const before = rec(s, 'Alex Rivera');
    const partial = 'customer_name,customer_email,estimate_date,estimate_amount\nAlex Rivera,alex.rivera@example.com,2026-10-25,19000\n';
    const blanks = csvBlank();
    for (const text of [partial, blanks]) {
      const n = must(commitImportText(s, f.pilotId, text));
      const after = rec(n, 'Alex Rivera');
      expect(after.estimateStatus).toBe('open');
      expect(after.lastContactDate).toBe(before.lastContactDate);
      expect(after.previousFollowUps).toBe(2);
      expect(after.service).toBe(before.service);
      expect(after.eligibility.status).toBe('eligible');
    }
    s = must(commitImportText(s, f.pilotId, partial));
    expect(rec(s, 'Alex Rivera').estimateAmount).toBe(19000);
  });

  it('an explicit change to "unknown" status sends an eligible record back to review', () => {
    const f = fixture();
    let s = eligible(importRows(f.s, f.pilotId, [row()]), 'Alex Rivera');
    s = importRows(s, f.pilotId, [row({ estimate_status: 'unknown' })], { 2: 'update' });
    expect(rec(s, 'Alex Rivera').eligibility.status).toBe('pending_review');
  });
});

function csvBlank(): string {
  return csv([row({ estimate_status: '', last_contact_date: '', previous_follow_up_count: '', service_requested: '', estimate_amount: '19000' })]);
}
function commitImportText(s: WorkbenchState, pilotId: string, text: string) {
  return commitImport(s, pilotId, text, 'partial.csv', { 2: 'update' }, clock);
}

describe('contractor report breakdown', () => {
  it('review outcome partitions the imported records exactly', () => {
    const s = withDemoData(emptyState(), TODAY);
    for (const p of s.pilots) {
      const r = pilotReport(s, p.id, TODAY);
      const o = r.reviewOutcome;
      expect(o.clearedForFollowUp + o.excludedByContractor + o.doNotContact + o.notContactable).toBe(r.dataQuality.imported);
      expect(o.laterOptedOutOrRestricted).toBeLessThanOrEqual(o.clearedForFollowUp);
    }
  });

  it('handoff list is limited to the pilot and ordered by response date', async () => {
    const { handoffList } = await import('./report.ts');
    const s = withDemoData(emptyState(), TODAY);
    const pid = s.pilots[0]!.id;
    const list = handoffList(s, pid);
    expect(list.length).toBe(pilotReport(s, pid, TODAY).outcomes.handoffs);
    expect(list.map((h) => h.handoff.respondedOn)).toEqual([...list.map((h) => h.handoff.respondedOn)].sort());
    expect(handoffList(s, s.pilots[1]!.id)).toEqual([]);
  });
});
