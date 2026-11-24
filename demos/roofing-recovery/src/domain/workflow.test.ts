import { describe, expect, it } from 'vitest';
import { clockAt } from './dates.ts';
import { prioritize } from './priority.ts';
import { buildQueue, workflowStatus } from './queue.ts';
import {
  acknowledgeHandoff,
  approveDrafts,
  closeRecord,
  confirmContact,
  createHandoff,
  editDraft,
  excludeRecord,
  markHandoffNotified,
  openTouch,
  prepareDraft,
  qualifyReengagement,
  recordHandoffOutcome,
  recordResponse,
  reviewRestriction,
  setEligibility,
  submitForApproval,
  suppressRecord,
  updateRecordDetails,
  type ContactInput,
} from './records.ts';
import { setPilotStatus } from './setup.ts';
import { must } from './state.ts';
import type { WorkbenchState } from './types.ts';
import { clock, eligible, fixture, importRows, rec, row, TODAY } from './testkit.ts';

const contactIn = (over: Partial<ContactInput> = {}): ContactInput => ({ confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'no_response', notes: '', ...over });

/** Import + eligible + draft + submitted. */
function ready(names: string[]): { s: WorkbenchState; pilotId: string } {
  const f = fixture();
  let s = importRows(f.s, f.pilotId, names.map((n, i) => row({ customer_name: n, customer_email: `${n.toLowerCase().replace(/\W/g, '')}@example.com`, customer_phone: `512-555-02${String(10 + i)}` })));
  for (const n of names) {
    s = eligible(s, n);
    s = must(prepareDraft(s, rec(s, n).id, clock));
  }
  s = must(submitForApproval(s, names.map((n) => openTouch(rec(s, n))!.id), clock));
  return { s, pilotId: f.pilotId };
}
const tid = (s: WorkbenchState, n: string) => (openTouch(rec(s, n)) ?? rec(s, n).touches.at(-1)!).id;

describe('eligibility', () => {
  it('cannot mark eligible without documented authorization for an approved channel', () => {
    const { s, pilotId } = fixture();
    const n = importRows(s, pilotId, [row({ email_consent: 'unknown', phone_consent: 'no' })]);
    const r = setEligibility(n, rec(n, 'Alex Rivera').id, 'eligible', '', clock);
    expect(!r.ok && r.error).toMatch(/No pilot-approved channel has documented consent/);
    expect(prepareDraft(n, rec(n, 'Alex Rivera').id, clock).ok).toBe(false);
  });

  it('suppressed and excluded records cannot be changed by an ordinary eligibility decision', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    const id = rec(n, 'Alex Rivera').id;
    n = must(suppressRecord(n, id, { reason: 'Do not contact', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    expect(setEligibility(n, id, 'eligible', '', clock).ok).toBe(false);
    expect(setEligibility(n, id, 'pending_review', 'x', clock).ok).toBe(false);
    expect(excludeRecord(n, id, 'x', clock).ok).toBe(false);
  });

  it('suppression reversal needs a reason, returns to review (not eligible), and is audited', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    const id = rec(n, 'Alex Rivera').id;
    n = must(suppressRecord(n, id, { reason: 'Do not contact', channel: 'email', date: TODAY, source: 'operator' }, clock));
    expect(reviewRestriction(n, id, 'oops', clock).ok).toBe(false);
    n = must(reviewRestriction(n, id, 'Suppressed the wrong homeowner by mistake', clock));
    expect(rec(n, 'Alex Rivera').eligibility.status).toBe('pending_review');
    expect(n.suppression.every((e) => !e.active && e.reversalReason)).toBe(true);
    expect(n.events.some((e) => e.type === 'suppression_reversed' && e.recordId === id)).toBe(true);
  });

  it('editing authorization on an eligible record sends it back to review', () => {
    const { s, pilotId } = fixture();
    let n = eligible(importRows(s, pilotId, [row()]), 'Alex Rivera');
    const r = rec(n, 'Alex Rivera');
    n = must(updateRecordDetails(n, r.id, { email: r.email!, phone: r.phone!, authorization: { ...r.authorization, evidence: 'Updated evidence' } }, clock));
    expect(rec(n, 'Alex Rivera').eligibility.status).toBe('pending_review');
  });
});

describe('state precedence: suppression and exclusion override every workflow state', () => {
  it('suppression after approval blocks the approved draft and every further action', () => {
    let { s } = ready(['Ann Lee']);
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    const t = tid(s, 'Ann Lee');
    s = must(suppressRecord(s, rec(s, 'Ann Lee').id, { reason: 'Called to opt out', channel: 'phone', date: TODAY, source: 'homeowner' }, clock));
    const touch = rec(s, 'Ann Lee').touches.find((x) => x.id === t)!;
    expect(touch.status).toBe('blocked');
    expect(touch.blockedReason).toMatch(/Suppressed/);
    expect(confirmContact(s, t, contactIn(), clock).ok).toBe(false);
    expect(editDraft(s, t, 'new text', clock).ok).toBe(false);
    expect(prepareDraft(s, rec(s, 'Ann Lee').id, clock).ok).toBe(false);
    const batch = approveDrafts(s, [t], clock);
    expect(batch.ok && batch.batch?.done).toEqual([]);
    expect(buildQueue(s, TODAY).some((q) => q.recordId === rec(s, 'Ann Lee').id)).toBe(false);
    expect(prioritize(s, rec(s, 'Ann Lee'), TODAY).category).toBe('none');
  });

  it('even a lifted suppression does not unblock old drafts', () => {
    let { s } = ready(['Ann Lee']);
    s = must(suppressRecord(s, rec(s, 'Ann Lee').id, { reason: 'x', channel: 'other', date: TODAY, source: 'operator' }, clock));
    s = must(reviewRestriction(s, rec(s, 'Ann Lee').id, 'Wrong record suppressed by mistake', clock));
    expect(rec(s, 'Ann Lee').touches[0]!.status).toBe('blocked');
    expect(approveDrafts(s, [rec(s, 'Ann Lee').touches[0]!.id], clock).batch?.done).toEqual([]);
  });

  it('suppression after outreach stops the sequence', () => {
    let { s } = ready(['Ann Lee']);
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    s = must(confirmContact(s, tid(s, 'Ann Lee'), contactIn(), clock));
    s = must(suppressRecord(s, rec(s, 'Ann Lee').id, { reason: 'Asked to stop', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const later = clockAt('2026-12-10');
    expect(prepareDraft(s, rec(s, 'Ann Lee').id, later).ok).toBe(false);
    expect(buildQueue(s, '2026-12-10').some((q) => q.recordId === rec(s, 'Ann Lee').id)).toBe(false);
  });
});

describe('batch approval validates each record independently', () => {
  it('approves the valid ones and reports why the others were blocked', () => {
    let { s, pilotId } = ready(['Ann Lee', 'Ben Cho', 'Cy Dunn', 'Di Eve']);
    const ids = ['Ann Lee', 'Ben Cho', 'Cy Dunn', 'Di Eve'].map((n) => tid(s, n));
    s = must(excludeRecord(s, rec(s, 'Ben Cho').id, 'Contractor asked', clock));
    s = must(suppressRecord(s, rec(s, 'Cy Dunn').id, { reason: 'Opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    // Di Eve's estimate changes (contractor re-import) after the draft was prepared.
    const d = rec(s, 'Di Eve');
    s = importRows(s, pilotId, [row({ customer_name: 'Di Eve', customer_email: d.email!, customer_phone: '', estimate_amount: '25000' })], { 2: 'update' });
    const r = approveDrafts(s, ids, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batch!.done.map((x) => x.name)).toEqual(['Ann Lee']);
    const blocked = Object.fromEntries(r.batch!.blocked.map((b) => [b.name, b.reasons.join(' ')]));
    expect(blocked['Ben Cho']).toMatch(/Status is "blocked"/);
    expect(blocked['Cy Dunn']).toMatch(/Status is "blocked"/);
    expect(blocked['Di Eve']).toMatch(/Record changed since the draft was prepared/);
    expect(rec(r.state, 'Ann Lee').touches[0]!.status).toBe('approved');
    expect(rec(r.state, 'Di Eve').touches[0]!.status).toBe('awaiting_approval');
    expect(r.state.events.filter((e) => e.type === 'approval_blocked')).toHaveLength(3);
  });

  it('revalidates restrictions even when the draft itself is still awaiting approval', () => {
    let { s, pilotId } = ready(['Ann Lee']);
    s = must(setPilotStatus(s, pilotId, 'paused', clock));
    const r = approveDrafts(s, [tid(s, 'Ann Lee')], clock);
    expect(r.ok && r.batch!.blocked[0]!.reasons.join(' ')).toMatch(/Pilot is paused/);
  });

  it('cannot approve drafts that were never submitted, nor approve twice', () => {
    const f = fixture();
    let s = eligible(importRows(f.s, f.pilotId, [row()]), 'Alex Rivera');
    s = must(prepareDraft(s, rec(s, 'Alex Rivera').id, clock));
    const t = tid(s, 'Alex Rivera');
    expect(approveDrafts(s, [t], clock).batch?.blocked[0]?.reasons).toEqual(['Not yet submitted to the contractor']);
    s = must(submitForApproval(s, [t], clock));
    s = must(approveDrafts(s, [t], clock));
    expect(approveDrafts(s, [t], clock).batch?.done).toEqual([]);
  });

  it('editing a submitted draft returns it to draft and requires resubmission', () => {
    let { s } = ready(['Ann Lee']);
    s = must(editDraft(s, tid(s, 'Ann Lee'), 'Hi Ann, edited text.', clock));
    expect(rec(s, 'Ann Lee').touches[0]!.status).toBe('draft');
  });
});

describe('manual outreach confirmation', () => {
  it('approved is not contacted; contact needs explicit confirmation, a valid date and the approved channel', () => {
    let { s } = ready(['Ann Lee']);
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    const t = tid(s, 'Ann Lee');
    expect(workflowStatus(s, rec(s, 'Ann Lee'))).toBe('approved');
    expect(confirmContact(s, t, contactIn({ confirmed: false }), clock).ok).toBe(false);
    expect(confirmContact(s, t, contactIn({ contactedOn: '2026-12-30' }), clock).ok).toBe(false);
    expect(confirmContact(s, t, contactIn({ channel: 'phone' }), clock).ok).toBe(false);
    s = must(confirmContact(s, t, contactIn(), clock));
    expect(rec(s, 'Ann Lee').touches[0]!.status).toBe('contacted');
    const dup = confirmContact(s, t, contactIn(), clock);
    expect(!dup.ok && dup.error).toMatch(/already been recorded/);
  });

  it('a draft cannot be marked contacted without approval', () => {
    const { s } = ready(['Ann Lee']);
    expect(confirmContact(s, tid(s, 'Ann Lee'), contactIn(), clock).ok).toBe(false);
  });

  it('follows the Day 1 / 4 / 9 sequence and completes after the final step', () => {
    let { s } = ready(['Ann Lee']);
    const go = (date: string) => {
      const c = clockAt(date);
      s = must(prepareDraft(s, rec(s, 'Ann Lee').id, c));
      s = must(submitForApproval(s, [tid(s, 'Ann Lee')], c));
      s = must(approveDrafts(s, [tid(s, 'Ann Lee')], c));
      s = must(confirmContact(s, tid(s, 'Ann Lee'), contactIn({ contactedOn: date, channel: openTouch(rec(s, 'Ann Lee'))!.channel }), c));
    };
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    s = must(confirmContact(s, tid(s, 'Ann Lee'), contactIn(), clock));
    expect(buildQueue(s, '2026-11-26').some((q) => q.kind === 'prepare_draft')).toBe(false); // Day 4 not yet due
    expect(buildQueue(s, '2026-11-27').find((q) => q.kind === 'prepare_draft')?.dueOn).toBe('2026-11-27');
    go('2026-11-27');
    expect(rec(s, 'Ann Lee').touches[1]!.channel).toBe('phone');
    go('2026-12-02');
    expect(workflowStatus(s, rec(s, 'Ann Lee'))).toBe('sequence_complete');
    expect(prepareDraft(s, rec(s, 'Ann Lee').id, clockAt('2026-12-05')).ok).toBe(false);
  });
});

describe('homeowner responses', () => {
  function contacted(outcome: ContactInput['outcome']) {
    let { s } = ready(['Ann Lee']);
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    return must(confirmContact(s, tid(s, 'Ann Lee'), contactIn({ outcome }), clock));
  }

  it('an opt-out suppresses, adds to the ledger, stops outreach and survives re-import', () => {
    const s = contacted('opted_out');
    const r = rec(s, 'Ann Lee');
    expect(r.eligibility.status).toBe('suppressed');
    expect(s.suppression.some((e) => e.email === r.email && e.active)).toBe(true);
    expect(s.events.some((e) => e.type === 'opt_out_recorded')).toBe(true);
    const re = importRows(s, r.pilotId, [row({ customer_name: 'Ann Lee', customer_email: r.email!, customer_phone: '' })], { 2: 'skip' });
    expect(rec(re, 'Ann Lee').eligibility.status).toBe('suppressed');
  });

  it('not interested closes; wrong contact makes ineligible', () => {
    expect(contacted('not_interested').records[0]!.closed?.reason).toBe('Homeowner not interested');
    const w = contacted('wrong_contact').records[0]!;
    expect(w.eligibility.status).toBe('ineligible');
  });

  it('a generic reply is not a qualified re-engagement until the operator confirms it', () => {
    let s = contacted('other');
    const id = s.records[0]!.id;
    expect(workflowStatus(s, s.records[0]!)).toBe('reply');
    expect(qualifyReengagement(s, id, { confirmed: false, request: 'callback', notes: '' }, clock).ok).toBe(false);
    expect(createHandoff(s, id, { respondedOn: TODAY, homeownerRequest: 'x', conversationNotes: '', nextAction: 'y' }, clock).ok).toBe(false);
    s = must(closeRecord(s, id, 'Reply was an auto-responder', clock));
    expect(workflowStatus(s, s.records[0]!)).toBe('closed');
  });

  it('no response cannot be qualified; a late reply can be recorded once', () => {
    let s = contacted('no_response');
    const id = s.records[0]!.id;
    expect(qualifyReengagement(s, id, { confirmed: true, request: 'callback', notes: '' }, clock).ok).toBe(false);
    s = must(recordResponse(s, id, { outcome: 'callback', date: TODAY, channel: 'email', notes: 'Call me Friday' }, clock));
    expect(recordResponse(s, id, { outcome: 'interested', date: TODAY, channel: 'email', notes: '' }, clock).ok).toBe(false);
    expect(s.events.some((e) => e.type === 'response_recorded' && e.from === 'no_response' && e.to === 'callback')).toBe(true);
  });
});

describe('warm handoffs', () => {
  it('follows created → notified → acknowledged → outcome and rejects skipped steps', () => {
    let { s } = ready(['Ann Lee']);
    s = must(approveDrafts(s, [tid(s, 'Ann Lee')], clock));
    s = must(confirmContact(s, tid(s, 'Ann Lee'), contactIn({ outcome: 'inspection' }), clock));
    const id = rec(s, 'Ann Lee').id;
    s = must(qualifyReengagement(s, id, { confirmed: true, request: 'inspection', notes: '' }, clock));
    const hin = { respondedOn: TODAY, homeownerRequest: 'Inspection', conversationNotes: '', nextAction: 'Book it' };
    s = must(createHandoff(s, id, hin, clock));
    expect(createHandoff(s, id, hin, clock).ok).toBe(false);
    expect(acknowledgeHandoff(s, id, TODAY, '', clock).ok).toBe(false); // not yet notified
    const outcome = { outcome: 'appointment_reported' as const, date: TODAY, notes: '', verifiedByContractor: false, jobValue: null };
    expect(recordHandoffOutcome(s, id, outcome, clock).ok).toBe(false); // not acknowledged
    s = must(markHandoffNotified(s, id, TODAY, clock));
    s = must(acknowledgeHandoff(s, id, TODAY, 'Will call', clock));
    expect(recordHandoffOutcome(s, id, { ...outcome, outcome: 'job_won_verified' }, clock).ok).toBe(false); // needs verification
    s = must(recordHandoffOutcome(s, id, outcome, clock));
    s = must(recordHandoffOutcome(s, id, { ...outcome, outcome: 'job_won_verified', verifiedByContractor: true, jobValue: 17000 }, clock));
    expect(rec(s, 'Ann Lee').handoff).toMatchObject({ outcome: 'job_won_verified', reportedJobValue: 17000 });
    expect(s.events.filter((e) => e.type.startsWith('handoff_')).map((e) => e.type)).toEqual([
      'handoff_created',
      'handoff_notified',
      'handoff_acknowledged',
      'handoff_outcome',
      'handoff_outcome',
    ]);
  });
});

describe('prioritisation and queue', () => {
  it('assigns transparent categories without predicting conversion', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [
      row({ customer_name: 'Big', customer_email: 'big@example.com', customer_phone: '' }),
      row({ customer_name: 'Old', customer_email: 'old@example.com', customer_phone: '', estimate_date: '2026-08-01' }),
      row({ customer_name: 'Fresh', customer_email: 'fresh@example.com', customer_phone: '', estimate_date: '2026-11-20' }),
      row({ customer_name: 'Mid', customer_email: 'mid@example.com', customer_phone: '', estimate_amount: '9000', estimate_date: '2026-10-10', previous_follow_up_count: '1' }),
      row({ customer_name: 'Review', customer_email: 'r@example.com', customer_phone: '', authorization_evidence: '' }),
    ]);
    for (const x of ['Big', 'Old', 'Fresh', 'Mid']) n = eligible(n, x);
    const p = (x: string) => prioritize(n, rec(n, x), TODAY);
    expect(p('Big').category).toBe('high');
    expect(p('Mid').category).toBe('medium');
    expect(p('Old').category).toBe('low');
    expect(p('Fresh').category).toBe('none');
    expect(p('Review').category).toBe('review');
    expect(p('Review').summary).toMatch(/No authorization evidence/);
    for (const x of ['Big', 'Old', 'Fresh', 'Mid', 'Review']) {
      const r = p(x);
      expect([r.summary, ...r.factors.map((f) => f.label)].join(' ')).not.toMatch(/probab|likely|predict|convert/i);
    }
  });

  it('orders the queue: review, drafts/approvals, due contacts, replies, handoffs', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row({ customer_name: 'R', customer_email: 'r@example.com', customer_phone: '', authorization_evidence: '' }), row({ customer_name: 'E', customer_email: 'e@example.com', customer_phone: '' })]);
    n = eligible(n, 'E');
    const kinds = buildQueue(n, TODAY).map((q) => [q.group, q.kind]);
    expect(kinds).toEqual([
      [1, 'review'],
      [2, 'prepare_draft'],
    ]);
  });
});

describe('atomicity', () => {
  it('a rejected command leaves the state untouched and logs nothing', () => {
    const { s } = ready(['Ann Lee']);
    const before = JSON.stringify(s);
    const r = confirmContact(s, tid(s, 'Ann Lee'), contactIn(), clock);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});
