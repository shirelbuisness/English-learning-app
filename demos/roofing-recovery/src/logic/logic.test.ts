import { describe, expect, it } from 'vitest';
import { createSeedLeads } from '../data/seedLeads.ts';
import { importLeadsCsv, CSV_EXAMPLE, parseCsv } from './csv.ts';
import { DEMO_AS_OF, daysBetween } from './dates.ts';
import { currentDraft, suggestedDraft } from './drafts.ts';
import { computeMetrics } from './metrics.ts';
import { assessLead } from './priority.ts';
import { loadLeads, saveLeads } from './storage.ts';
import type { Lead } from './types.ts';
import {
  approveFollowUp,
  completeFollowUp,
  dismissFollowUp,
  editDraft,
  recordOutcome,
  reopenFollowUp,
  reviseFollowUp,
  type TransitionResult,
} from './workflow.ts';

const AS_OF = DEMO_AS_OF;

function byId(id: string, leads: Lead[] = createSeedLeads()): Lead {
  const lead = leads.find((l) => l.id === id);
  if (!lead) throw new Error(`no lead ${id}`);
  return lead;
}

function ok(r: TransitionResult): Lead {
  if (!r.ok) throw new Error(r.error);
  return r.lead;
}

describe('seed data', () => {
  it('has 15–20 leads with unique ids, Texas locations and valid dates', () => {
    const leads = createSeedLeads();
    expect(leads.length).toBeGreaterThanOrEqual(15);
    expect(leads.length).toBeLessThanOrEqual(20);
    expect(new Set(leads.map((l) => l.id)).size).toBe(leads.length);
    for (const l of leads) {
      expect(l.city).toMatch(/, TX$/);
      expect(l.email).toMatch(/@example\.com$/);
      expect(daysBetween(l.receivedDate, AS_OF)).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers every scenario the demo needs', () => {
    const leads = createSeedLeads();
    const situations = new Set(leads.map((l) => assessLead(l, AS_OF).situation));
    expect(situations).toEqual(
      new Set([null, 'unanswered_inquiry', 'estimate_no_response', 'stalled_conversation', 'unanswered_reply']),
    );
    const statuses = new Set(leads.map((l) => l.status));
    for (const s of ['job_booked', 'closed_lost', 'opted_out'] as const) expect(statuses).toContain(s);
  });

  it('returns fresh copies so mutations cannot leak into a reset', () => {
    const a = createSeedLeads();
    a[0]!.history.push({ date: AS_OF, channel: 'text', direction: 'outbound', summary: 'x' });
    expect(createSeedLeads()[0]!.history.length).toBe(a[0]!.history.length - 1);
  });
});

describe('priority and eligibility rules', () => {
  it('flags a high-value estimate with no follow-up as High and explains why', () => {
    const a = assessLead(byId('L-1042'), AS_OF);
    expect(a.priority).toBe('high');
    expect(a.actionable).toBe(true);
    expect(a.factors.map((f) => f.label).join(' ')).toMatch(/No follow-up made/);
    expect(a.score).toBe(a.factors.reduce((s, f) => s + f.points, 0));
  });

  it('treats an unanswered customer reply as High even for a small job', () => {
    const a = assessLead(byId('L-1055'), AS_OF);
    expect(a.priority).toBe('high');
    expect(a.situation).toBe('unanswered_reply');
  });

  it.each(['L-1003', 'L-0968', 'L-1026'])('never recommends follow-up for booked, closed or opted-out lead %s', (id) => {
    const a = assessLead(byId(id), AS_OF);
    expect(a.priority).toBe('none');
    expect(a.actionable).toBe(false);
  });

  it('stops after the contact limit and waits after a recent contact', () => {
    expect(assessLead(byId('L-0921'), AS_OF).summary).toMatch(/Contact limit reached/);
    expect(assessLead(byId('L-1058'), AS_OF).summary).toMatch(/Contacted 1 day ago/);
  });

  it('ranks low-value, recently touched leads Low', () => {
    expect(assessLead(byId('L-1038'), AS_OF).priority).toBe('low');
    expect(assessLead(byId('L-0952'), AS_OF).priority).toBe('low');
  });

  it('never claims to predict conversion', () => {
    for (const l of createSeedLeads()) {
      const a = assessLead(l, AS_OF);
      const text = [a.summary, a.nextAction, ...a.factors.map((f) => f.label)].join(' ');
      expect(text).not.toMatch(/probab|likely to (buy|close|convert)|predict/i);
    }
  });
});

describe('drafts', () => {
  it('personalises inquiry and estimate drafts', () => {
    const inquiry = suggestedDraft(byId('L-1051'));
    expect(inquiry).toMatch(/^Hi Maria,/);
    expect(inquiry).toContain('Round Rock');
    const estimate = suggestedDraft(byId('L-1042'));
    expect(estimate).toMatch(/^Hi James,/);
    expect(estimate).toContain('estimate we sent on Oct 31');
  });
});

describe('follow-up workflow', () => {
  it('runs the full journey: edit → approve → complete → outcome', () => {
    let lead = byId('L-1042');
    lead = ok(editDraft(lead, 'Hi James, quick check-in on your estimate.', AS_OF));
    lead = ok(approveFollowUp(lead, AS_OF));
    expect(lead.followUp).toMatchObject({ state: 'approved', draft: 'Hi James, quick check-in on your estimate.', approvedOn: AS_OF });
    lead = ok(completeFollowUp(lead, AS_OF));
    expect(lead.followUp.state).toBe('completed');
    expect(lead.followUpCount).toBe(1);
    expect(lead.lastContactDate).toBe(AS_OF);
    expect(lead.history.at(-1)?.summary).toMatch(/nothing was sent/);
    expect(assessLead(lead, AS_OF).actionable).toBe(false);
    lead = ok(recordOutcome(lead, 'replied', AS_OF));
    lead = ok(recordOutcome(lead, 'appointment', AS_OF));
    expect(lead.followUp.outcome).toBe('appointment');
  });

  it('rejects invalid transitions', () => {
    const open = byId('L-1042');
    expect(completeFollowUp(open, AS_OF).ok).toBe(false); // not approved
    expect(recordOutcome(open, 'replied', AS_OF).ok).toBe(false); // not completed
    expect(reopenFollowUp(open).ok).toBe(false);
    expect(reviseFollowUp(open).ok).toBe(false);

    const approved = ok(approveFollowUp(open, AS_OF));
    expect(approveFollowUp(approved, AS_OF).ok).toBe(false); // double approve
    expect(editDraft(approved, 'x', AS_OF).ok).toBe(false); // locked once approved

    const done = ok(completeFollowUp(approved, AS_OF));
    const again = completeFollowUp(done, AS_OF);
    expect(again.ok).toBe(false); // duplicate completion
    expect(!again.ok && again.error).toMatch(/already been completed/);
    expect(dismissFollowUp(done).ok).toBe(false);

    const appt = ok(recordOutcome(done, 'appointment', AS_OF));
    expect(recordOutcome(appt, 'replied', AS_OF).ok).toBe(false); // no downgrade
  });

  it('blocks approval for ineligible leads and empty messages', () => {
    expect(approveFollowUp(byId('L-1026'), AS_OF).ok).toBe(false); // opted out
    expect(approveFollowUp(byId('L-1003'), AS_OF).ok).toBe(false); // booked
    const blank = ok(editDraft(byId('L-1042'), '   ', AS_OF));
    expect(approveFollowUp(blank, AS_OF).ok).toBe(false);
  });

  it('supports dismiss, restore and revise', () => {
    const dismissed = ok(dismissFollowUp(byId('L-1042')));
    expect(assessLead(dismissed, AS_OF).actionable).toBe(false);
    const reopened = ok(reopenFollowUp(dismissed));
    expect(assessLead(reopened, AS_OF).priority).toBe('high');
    const revised = ok(reviseFollowUp(ok(approveFollowUp(reopened, AS_OF))));
    expect(revised.followUp.state).toBe('open');
  });

  it('keeps the approved text even if it matches the suggestion', () => {
    const lead = ok(approveFollowUp(byId('L-1051'), AS_OF));
    expect(currentDraft(lead)).toBe(suggestedDraft(byId('L-1051')));
  });
});

describe('metrics', () => {
  it('derives consistent figures from the seed', () => {
    const leads = createSeedLeads();
    const m = computeMetrics(leads, AS_OF);
    expect(m.leadsReviewed).toBe(leads.length);
    expect(m.priority.high.count + m.priority.medium.count + m.priority.low.count).toBe(m.needsFollowUp.count);
    expect(m.priority.none.count + m.needsFollowUp.count).toBe(leads.length);
    const situationTotal = Object.values(m.situations).reduce((s, v) => s + v.count, 0);
    expect(situationTotal).toBe(m.needsFollowUp.count);
    expect(m.completed.count).toBe(3);
    expect(m.replies.count).toBe(2);
    expect(m.appointments.count).toBe(1);
    // Booked/closed/opted-out values are excluded from open opportunity value.
    const resolved = leads.filter((l) => ['job_booked', 'closed_lost', 'opted_out'].includes(l.status));
    expect(m.openOpportunities.value).toBe(
      leads.reduce((s, l) => s + l.estimateValue, 0) - resolved.reduce((s, l) => s + l.estimateValue, 0),
    );
  });

  it('updates after approving and completing a follow-up', () => {
    const leads = createSeedLeads();
    const before = computeMetrics(leads, AS_OF);
    const i = leads.findIndex((l) => l.id === 'L-1042');
    leads[i] = ok(approveFollowUp(leads[i]!, AS_OF));
    const mid = computeMetrics(leads, AS_OF);
    expect(mid.approved.count).toBe(before.approved.count + 1);
    expect(mid.needsFollowUp.count).toBe(before.needsFollowUp.count);
    leads[i] = ok(completeFollowUp(leads[i]!, AS_OF));
    const after = computeMetrics(leads, AS_OF);
    expect(after.approved.count).toBe(before.approved.count);
    expect(after.completed.count).toBe(before.completed.count + 1);
    expect(after.needsFollowUp.count).toBe(before.needsFollowUp.count - 1);
    expect(after.priority.high.count).toBe(before.priority.high.count - 1);
    expect(after.openOpportunities.value).toBe(before.openOpportunities.value);
  });
});

describe('persistence', () => {
  it('round-trips and rejects malformed data', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadLeads(storage)).toBeNull();
    const leads = createSeedLeads();
    saveLeads(storage, leads);
    expect(loadLeads(storage)).toEqual(leads);
    mem.set('roofing-recovery-demo:v1', '{"leads":[{"id":1}]}');
    expect(loadLeads(storage)).toBeNull();
    mem.set('roofing-recovery-demo:v1', 'not json');
    expect(loadLeads(storage)).toBeNull();
  });
});

describe('CSV import', () => {
  const ids = new Set<string>();

  it('parses quoted fields', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('imports the documented example', () => {
    const r = importLeadsCsv(CSV_EXAMPLE, ids, AS_OF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.leads[0]).toMatchObject({ name: 'Sample Customer', city: 'Killeen, TX', estimateValue: 1450, status: 'new_inquiry' });
      expect(assessLead(r.leads[0]!, AS_OF).actionable).toBe(true);
    }
  });

  it('accepts status labels and $-formatted values', () => {
    const csv = `${CSV_EXAMPLE.split('\n')[0]}\nA B,"Waco, TX",Angi,2026-11-01,Repair,"$12,500",Estimate sent,2026-11-02,1\n`;
    const r = importLeadsCsv(csv, ids, AS_OF);
    expect(r.ok && r.leads[0]?.estimateValue).toBe(12500);
  });

  it('rejects missing columns, bad rows and empty files with clear messages', () => {
    expect(importLeadsCsv('', ids, AS_OF)).toEqual({ ok: false, errors: ['The file is empty.'] });
    const noCols = importLeadsCsv('name,city\nx,y', ids, AS_OF);
    expect(!noCols.ok && noCols.errors[0]).toMatch(/Missing required column/);
    const header = CSV_EXAMPLE.split('\n')[0];
    const bad = importLeadsCsv(`${header}\n,Austin,Web,2026-13-01,Repair,abc,unknown,,x\n`, ids, AS_OF);
    expect(bad.ok).toBe(false);
    const msg = !bad.ok ? bad.errors[0]! : '';
    for (const part of ['Row 2', 'name is required', 'received_date', 'estimate_value', 'follow_up_count', 'status']) {
      expect(msg).toContain(part);
    }
    const future = importLeadsCsv(`${header}\nA,Austin,Web,2027-01-01,Repair,100,new_inquiry,,0\n`, ids, AS_OF);
    expect(!future.ok && future.errors[0]).toMatch(/future/);
  });

  it('avoids id collisions with existing leads', () => {
    const r = importLeadsCsv(CSV_EXAMPLE, new Set(['IMP-001']), AS_OF);
    expect(r.ok && r.leads[0]?.id).toBe('IMP-002');
  });
});
