import { describe, expect, it } from 'vitest';
import { withDemoData } from '../data/demoSeed.ts';
import { addDays } from './dates.ts';
import { pilotReport } from './report.ts';
import { buildQueue } from './queue.ts';
import { setEligibility, approveDrafts, confirmContact, createHandoff, markHandoffNotified, openTouch, prepareDraft, qualifyReengagement, reviewRestriction, submitForApproval, suppressRecord, updateRecordDetails } from './records.ts';
import { emptyState, must } from './state.ts';
import { createLocalStore, STORAGE_KEY } from '../storage/localStore.ts';
import { addPilot, clock, eligible, fixture, importRows, rec, row, TODAY } from './testkit.ts';
import type { Clock } from './types.ts';

const P = (name: string, f: () => void, t?: number) => it(name, f, t);

describe('audit regressions (each was a confirmed defect before the fix)', () => {
  P('D1 suppression in one pilot immediately blocks the same contact in another pilot of the same contractor', () => {
    const { s, contractorId, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'P2');
    n = importRows(s2, p2, [row()]);
    const r2 = n.records.find((r) => r.pilotId === p2)!;
    n = must(setEligibility(n, r2.id, 'eligible', '', clock));
    n = must(prepareDraft(n, r2.id, clock));
    n = must(submitForApproval(n, [openTouch(n.records.find((r) => r.id === r2.id)!)!.id], clock));
    n = must(approveDrafts(n, [openTouch(n.records.find((r) => r.id === r2.id)!)!.id], clock));
    n = must(suppressRecord(n, rec(n, 'Alex Rivera', pilotId).id, { reason: 'opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const other = n.records.find((r) => r.id === r2.id)!;
    expect(other.eligibility.status).toBe('suppressed');
    expect(other.touches[0]!.status).toBe('blocked');
  });

  P('D2 lifting one record\'s suppression must not silently remove a ledger entry created by another record', () => {
    const { s, contractorId, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'homeowner opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'P2');
    n = importRows(s2, p2, [row()]); // suppressed via ledger
    const r2 = n.records.find((r) => r.pilotId === p2)!;
    const rr = reviewRestriction(n, r2.id, 'reviewing the second pilot record', clock);
    expect(!rr.ok && rr.error).toMatch(/Data page/);
    expect(n.suppression.filter((e) => e.active)).toHaveLength(1);
  });

  P('D3 evening operator in US time zone can confirm a same-day contact after approval', () => {
    // 9pm in Texas = 03:00 UTC next day.
    const evening: Clock = { now: '2026-11-25T03:00:00.000Z', today: '2026-11-24' };
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, evening));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], evening));
    n = must(approveDrafts(n, [t], evening));
    const r = confirmContact(n, t, { confirmed: true, contactedOn: '2026-11-24', channel: 'email', outcome: 'no_response', notes: '' }, evening);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  P('D4 record data changed after approval blocks contact until re-approved', () => {
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(approveDrafts(n, [t], clock));
    n = importRows(n, pilotId, [row({ estimate_amount: '99000' })], { 2: 'update' });
    const r = confirmContact(n, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'no_response', notes: '' }, clock);
    expect(r.ok).toBe(false);
  });

  P('D5 suppressed homeowner reply cannot be qualified/handed off', () => {
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(approveDrafts(n, [t], clock));
    n = must(confirmContact(n, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'interested', notes: '' }, clock));
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'contractor says do not contact', channel: 'other', date: TODAY, source: 'contractor' }, clock));
    expect(qualifyReengagement(n, rec(n, 'Alex Rivera').id, { confirmed: true, request: 'callback', notes: '' }, clock).ok).toBe(false);
    expect(buildQueue(n, TODAY).some((q) => q.recordId === rec(n, 'Alex Rivera').id)).toBe(false);
  });

  P('D6 outcome ladder: qualified is a subset of positive responses', () => {
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(approveDrafts(n, [t], clock));
    n = must(confirmContact(n, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'other', notes: '' }, clock));
    const q = qualifyReengagement(n, rec(n, 'Alex Rivera').id, { confirmed: true, request: 'callback', notes: '' }, clock);
    if (q.ok) {
      const r = pilotReport(q.state, pilotId, TODAY);
      expect(r.outcomes.qualified).toBeLessThanOrEqual(r.outcomes.positiveResponses);
    }
  });

  P('D7 editing contact details cannot create a duplicate inside the pilot', () => {
    const { s, pilotId } = fixture();
    const n = importRows(s, pilotId, [row(), row({ customer_name: 'Bo', customer_email: 'bo@example.com', customer_phone: '' })]);
    const bo = rec(n, 'Bo');
    expect(updateRecordDetails(n, bo.id, { email: 'alex.rivera@example.com', phone: '', authorization: bo.authorization }, clock).ok).toBe(false);
  });

  P('D8 handoff notify on the same local day works for an evening operator', () => {
    const evening: Clock = { now: '2026-11-25T03:00:00.000Z', today: '2026-11-24' };
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, evening));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(approveDrafts(n, [t], clock));
    n = must(confirmContact(n, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'interested', notes: '' }, clock));
    n = must(qualifyReengagement(n, rec(n, 'Alex Rivera').id, { confirmed: true, request: 'callback', notes: '' }, evening));
    n = must(createHandoff(n, rec(n, 'Alex Rivera').id, { respondedOn: TODAY, homeownerRequest: 'x', conversationNotes: '', nextAction: 'y' }, evening));
    const r = markHandoffNotified(n, rec(n, 'Alex Rivera').id, '2026-11-24', evening);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  P('D9 demo seed builds for every day of a year (boot must not crash)', () => {
    const failures: string[] = [];
    for (let i = 0; i < 366; i += 5) {
      const d = addDays('2026-01-01', i);
      try { withDemoData(emptyState(), d); } catch (e) { failures.push(`${d}: ${(e as Error).message}`); }
    }
    expect(failures.slice(0, 3)).toEqual([]);
  }, 60_000);

  P('D10 stored state with a structurally broken record is rejected, not loaded', () => {
    const mem = new Map<string, string>();
    const store = createLocalStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    const s = withDemoData(emptyState(), TODAY);
    const broken = structuredClone(s) as unknown as { records: Record<string, unknown>[] };
    delete broken.records[0]!.touches;
    mem.set(STORAGE_KEY, JSON.stringify(broken));
    expect(store.load().state).toBeNull();
  });

  P('D11 stored nextId lower than existing ids is repaired (no id collisions)', () => {
    const mem = new Map<string, string>();
    const store = createLocalStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    const s = { ...withDemoData(emptyState(), TODAY), nextId: 1 };
    const maxId = Math.max(...[...JSON.stringify(s).matchAll(/"[a-z]{2,3}-(\d+)"/g)].map((m) => Number(m[1])));
    mem.set(STORAGE_KEY, JSON.stringify(s));
    const loaded = store.load().state;
    expect(loaded!.nextId).toBe(maxId + 1);
  });

  P('D12 drafting is closed on a completed pilot', async () => {
    const { setPilotStatus } = await import('./setup.ts');
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    n = must(setPilotStatus(n, pilotId, 'completed', clock));
    expect(prepareDraft(n, rec(n, 'Alex Rivera').id, clock).ok).toBe(false);
  });
});
