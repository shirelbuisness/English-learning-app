import { describe, expect, it } from 'vitest';
import { withDemoData, DEMO_PILOT_NAME } from '../data/demoSeed.ts';
import { BACKUP_KEY, createLocalStore, STORAGE_KEY } from '../storage/localStore.ts';
import { toCsv } from './csv.ts';
import { addExpense, addTimeEntry, deleteTimeEntry } from './economics.ts';
import { analyzeImport } from './importer.ts';
import { clearPilot, clearPilotPreview, pilotExport, recordsCsv, reportCsv, stripDemo } from './lifecycle.ts';
import { buildQueue } from './queue.ts';
import { approveDrafts, confirmContact, openTouch } from './records.ts';
import { pilotReport } from './report.ts';
import { createContractor, createPilot, defaultPilotInput } from './setup.ts';
import { emptyState, must } from './state.ts';
import { REPLY_OUTCOMES } from './types.ts';
import { addPilot, clock, csv, fixture, importRows, rec, row, TODAY } from './testkit.ts';

const demo = () => withDemoData(emptyState(), TODAY);
const demoPilot = (s: ReturnType<typeof demo>) => s.pilots.find((p) => p.name === DEMO_PILOT_NAME)!.id;

describe('demo data', () => {
  it('is built entirely through domain commands and covers every queue group', () => {
    const s = demo();
    const groups = new Set(buildQueue(s, TODAY).map((q) => q.group));
    expect([...groups].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(s.records.every((r) => r.email === null || r.email.endsWith('@example.com'))).toBe(true);
    expect(s.contractors.every((c) => c.isDemo)).toBe(true);
    const pilotRecords = s.records.filter((r) => r.pilotId === demoPilot(s));
    expect(pilotRecords.length).toBeGreaterThanOrEqual(25);
    expect(pilotRecords.length).toBeLessThanOrEqual(40);
  });

  it('is deterministic for a given date', () => {
    expect(JSON.stringify(demo())).toBe(JSON.stringify(demo()));
  });
});

describe('pilot report', () => {
  it('is derived from records, touches, imports and events (independent recount)', () => {
    const s = demo();
    const pid = demoPilot(s);
    const r = pilotReport(s, pid, TODAY);
    const recs = s.records.filter((x) => x.pilotId === pid);
    const touches = recs.flatMap((x) => x.touches);
    expect(r.dataQuality.imported).toBe(recs.length);
    expect(r.dataQuality.awaitingReview + r.dataQuality.eligible + r.dataQuality.ineligible + r.dataQuality.excluded + r.dataQuality.suppressed).toBe(recs.length);
    expect(r.activity.draftsPrepared).toBe(touches.length);
    expect(r.activity.outreachCompleted).toBe(touches.filter((t) => t.status === 'contacted').length);
    expect(r.activity.repliesReceived).toBe(recs.filter((x) => x.touches.some((t) => t.outcome && REPLY_OUTCOMES.has(t.outcome))).length);
    expect(r.outcomes.handoffs).toBe(recs.filter((x) => x.handoff).length);
    expect(r.outcomes.optOuts).toBe(s.events.filter((e) => e.pilotId === pid && e.type === 'opt_out_recorded').length);
    // Ladder: each stage is a subset of the previous one.
    expect(r.outcomes.qualified).toBeLessThanOrEqual(r.activity.repliesReceived);
    expect(r.outcomes.handoffs).toBeLessThanOrEqual(r.outcomes.qualified);
    expect(r.outcomes.acknowledged).toBeLessThanOrEqual(r.outcomes.handoffs);
    expect(r.outcomes.appointmentsReported).toBeLessThanOrEqual(r.outcomes.acknowledged);
    expect(r.outcomes.jobsWonVerified).toBeLessThanOrEqual(r.outcomes.appointmentsReported);
    // Approved-but-not-contacted is never counted as outreach.
    expect(r.activity.draftsApproved).toBeGreaterThan(r.activity.outreachCompleted - 0);
    expect(r.activity.approvedNotContacted).toBe(touches.filter((t) => t.status === 'approved').length);
  });

  it('updates when an approved follow-up is confirmed, and only then', () => {
    let s = demo();
    const pid = demoPilot(s);
    const before = pilotReport(s, pid, TODAY);
    const item = buildQueue(s, TODAY, { pilotId: pid }).find((q) => q.kind === 'contact_due')!;
    const t = openTouch(s.records.find((r) => r.id === item.recordId)!)!;
    s = must(confirmContact(s, t.id, { confirmed: true, contactedOn: TODAY, channel: t.channel, outcome: 'interested', notes: '' }, clock));
    const after = pilotReport(s, pid, TODAY);
    expect(after.activity.outreachCompleted).toBe(before.activity.outreachCompleted + 1);
    expect(after.activity.approvedNotContacted).toBe(before.activity.approvedNotContacted - 1);
    expect(after.activity.draftsApproved).toBe(before.activity.draftsApproved);
    expect(after.activity.repliesReceived).toBe(before.activity.repliesReceived + 1);
    expect(after.outcomes.qualified).toBe(before.outcomes.qualified);
  });

  it('calculates economics from logged time, assumptions and expenses', () => {
    let { s, pilotId } = fixture();
    s = importRows(s, pilotId, [row(), row({ customer_name: 'B', customer_email: 'b@example.com', customer_phone: '' })]);
    s = must(addTimeEntry(s, pilotId, { category: 'data_cleanup', minutes: 90, date: TODAY, basis: 'measured', notes: '' }, clock));
    s = must(addTimeEntry(s, pilotId, { category: 'reporting', minutes: 30, date: TODAY, basis: 'estimated', notes: '' }, clock));
    s = must(addExpense(s, pilotId, { description: 'Phone', amount: 15, date: TODAY }, clock));
    expect(addTimeEntry(s, pilotId, { category: 'outreach', minutes: 0, date: TODAY, basis: 'measured', notes: '' }, clock).ok).toBe(false);
    const e = pilotReport(s, pilotId, TODAY).economics;
    expect(e).toMatchObject({ measuredMinutes: 90, estimatedMinutes: 30, totalMinutes: 120, hourlyCost: 45, laborCost: 90, expenses: 15, totalCost: 105, minutesPerImported: 60 });
    expect(e.contribution).toBe(-105);
    const id = s.timeEntries[0]!.id;
    s = must(deleteTimeEntry(s, id, clock));
    expect(pilotReport(s, pilotId, TODAY).economics.measuredMinutes).toBe(0);
    expect(s.events.some((x) => x.type === 'time_deleted')).toBe(true);
  });
});

describe('clear pilot data', () => {
  it('needs the typed pilot name, removes only that pilot and keeps the suppression ledger', () => {
    const s = demo();
    const pid = demoPilot(s);
    const other = s.pilots.find((p) => p.id !== pid)!;
    const otherRecords = s.records.filter((r) => r.pilotId === other.id);
    const ledger = s.suppression.length;
    expect(clearPilot(s, pid, 'wrong', clock).ok).toBe(false);
    const preview = clearPilotPreview(s, pid);
    const n = must(clearPilot(s, pid, DEMO_PILOT_NAME, clock));
    expect(n.pilots.some((p) => p.id === pid)).toBe(false);
    expect(n.records.some((r) => r.pilotId === pid)).toBe(false);
    expect(n.timeEntries.some((t) => t.pilotId === pid)).toBe(false);
    expect(n.events.some((e) => e.pilotId === pid)).toBe(false);
    expect(n.records.filter((r) => r.pilotId === other.id)).toEqual(otherRecords);
    expect(n.suppression).toHaveLength(ledger);
    const log = n.events.find((e) => e.type === 'pilot_cleared')!;
    expect(log.detail).toContain(`${preview.records} records`);
    // A suppressed contact from the cleared pilot stays suppressed when re-imported.
    const contractorId = s.pilots.find((p) => p.id === pid)!.contractorId;
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'New pilot');
    const a = analyzeImport(s2, p2, csv([row({ customer_name: 'Linda Okafor', customer_email: 'linda.okafor@example.com', customer_phone: '' })]), TODAY);
    expect(a.rows[0]!.ledgerSuppressed).toBe(true);
  });
});

describe('reset demo data', () => {
  it('restores demo data and does not touch operator pilots', () => {
    let s = demo();
    s = must(createContractor(s, { businessName: 'Real-ish Co', primaryContact: 'Op', email: '', phone: '', timeZone: 'America/Chicago', notes: '' }, clock));
    const cid = s.contractors.at(-1)!.id;
    s = must(createPilot(s, cid, { ...defaultPilotInput(TODAY), contactMode: 'in_workbench', name: 'Operator pilot', communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    const opPilot = s.pilots.at(-1)!.id;
    s = importRows(s, opPilot, [row()]);
    // Change the demo, then reset.
    const pid = demoPilot(s);
    const item = buildQueue(s, TODAY, { pilotId: pid }).find((q) => q.kind === 'awaiting_approval')!;
    s = must(approveDrafts(s, [item.touchId!], clock));
    const reset = withDemoData(s, TODAY);
    expect(reset.records.filter((r) => r.pilotId === opPilot)).toEqual(s.records.filter((r) => r.pilotId === opPilot));
    expect(reset.contractors.some((c) => c.id === cid)).toBe(true);
    const rp = demoPilot(reset);
    expect(buildQueue(reset, TODAY, { pilotId: rp }).some((q) => q.kind === 'awaiting_approval')).toBe(true);
    expect(stripDemo(reset).pilots.map((p) => p.name)).toEqual(['Operator pilot']);
    // ids never collide with operator data
    const ids = [...reset.records.map((r) => r.id), ...reset.pilots.map((p) => p.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a pilot created under a demo contractor is demo data', () => {
    let s = demo();
    const demoContractor = s.contractors[0]!.id;
    s = must(createPilot(s, demoContractor, { ...defaultPilotInput(TODAY), contactMode: 'in_workbench', name: 'Extra', communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    expect(s.pilots.at(-1)!.isDemo).toBe(true);
  });
});

describe('exports', () => {
  it('exports a complete, labelled pilot package and readable CSVs', () => {
    const s = demo();
    const pid = demoPilot(s);
    const x = pilotExport(s, pid, clock)!;
    expect(x.format).toBe('roofing-recovery-pilot-export');
    expect(x.syntheticDataOnly).toBe(true);
    expect(x.records.length).toBe(s.records.filter((r) => r.pilotId === pid).length);
    expect(x.events.length).toBeGreaterThan(0);
    expect(x.records.every((r) => r.pilotId === pid)).toBe(true);
    const rc = recordsCsv(s, pid, TODAY);
    expect(rc.split('\r\n').length - 2).toBe(x.records.length);
    expect(reportCsv(pilotReport(s, pid, TODAY))).toContain('Synthetic demonstration data');
  });

  it('neutralises spreadsheet formulas in CSV output', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['ok, "q"']])).toBe('a\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n"ok, ""q"""\r\n');
  });
});

describe('persistence boundary', () => {
  it('round-trips state and backs up unreadable data instead of discarding it', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const store = createLocalStore(storage);
    expect(store.load()).toEqual({ state: null, error: null, revision: 0 });
    const s = demo();
    expect(store.save(s, 0)).toEqual({ ok: true, revision: 1 });
    expect(store.load().state).toEqual(s);
    mem.set(STORAGE_KEY, '{"schemaVersion":1}');
    const bad = store.load();
    expect(bad.state).toBeNull();
    expect(bad.error).toMatch(/could not be read/);
    expect(mem.get(BACKUP_KEY)).toBe('{"schemaVersion":1}');
  });
});

describe('audit history', () => {
  it('records the key operational events for the demo record lifecycle', () => {
    const s = demo();
    const maria = rec(s, 'Maria Delgado', demoPilot(s));
    const types = s.events.filter((e) => e.recordId === maria.id).map((e) => e.type);
    for (const t of ['record_imported', 'eligibility_changed', 'draft_prepared', 'draft_submitted', 'draft_approved', 'outreach_confirmed', 'reengagement_qualified', 'handoff_created', 'handoff_notified', 'handoff_acknowledged', 'handoff_outcome']) {
      expect(types).toContain(t);
    }
    const events = s.events.map((e) => e.at);
    expect([...events].sort()).toEqual(events); // append-only, chronological
  });
});
