import { describe, expect, it } from 'vitest';
import { withSamplePipeline } from '../data/samplePipeline.ts';
import { buildQueue } from './queue.ts';
import { lastContacted, replyTextOf, setEligibility } from './records.ts';
import { contractorSummary, pilotReport, type PilotReport } from './report.ts';
import { defaultPilotInput } from './setup.ts';
import { emptyState, must } from './state.ts';
import { draftText } from './templates.ts';
import { approvalBatch, warmLeadCard } from './touchpoints.ts';
import { clock, TODAY } from './testkit.ts';

/* Regressions for the issues found in the screenshot review. */

const sample = () => withSamplePipeline(emptyState(), TODAY);

describe('1. the homeowner’s words are never mixed with the operator’s notes', () => {
  it('keeps the reply and the send note apart everywhere it is shown', () => {
    const s = sample();
    const sarah = s.records.find((r) => r.estimateRef === 'Q-2231')!;
    const t = lastContacted(sarah)!;
    expect(t.notes).toBe('Sent from Lone Star inbox');
    expect(replyTextOf(t)).toMatch(/^Yes, still want it done!/);
    const item = buildQueue(s, TODAY).find((q) => q.recordId === sarah.id)!;
    expect(item.detail).toMatch(/Requests callback: “Yes, still want it done!/);
    expect(item.detail).not.toMatch(/Sent from Lone Star inbox/);
    expect(warmLeadCard(s, sarah.id, TODAY)).not.toMatch(/Sent from Lone Star inbox/);
  });
});

describe('2. privacy-safe records read as permitted, not “unknown”', () => {
  it('uses plain wording for the eligibility reason in a privacy-safe pilot', () => {
    const s = sample();
    const karen = s.records.find((r) => r.estimateRef === 'Q-2255')!;
    const n = must(setEligibility(s, karen.id, 'eligible', '', clock));
    expect(n.records.find((r) => r.id === karen.id)!.eligibility.reason).toMatch(/contractor's permission/);
  });
});

describe('3. contractor report summary reads naturally in every state', () => {
  const base = (over: Partial<{ imported: number; cleared: number; contacted: number; replied: number; asked: number; passed: number }>) => {
    const v = { imported: 10, cleared: 8, contacted: 0, replied: 0, asked: 0, passed: 0, ...over };
    return {
      dataQuality: { imported: v.imported },
      reviewOutcome: { clearedForFollowUp: v.cleared },
      activity: { recordsContacted: v.contacted, repliesReceived: v.replied },
      outcomes: { qualified: v.asked, handoffs: v.passed },
    } as unknown as PilotReport;
  };
  it.each([
    [{}, "We reviewed 10 of your unsold estimates. 8 could be followed up under the contact permission you gave us. We haven't followed up with anyone yet."],
    [{ contacted: 2, replied: 0 }, 'No replies yet.'],
    [{ contacted: 2, replied: 1 }, '1 has replied so far.'],
    [{ contacted: 5, replied: 3, asked: 1, passed: 1 }, '3 replied, and 1 confirmed the project is still open and asked for a next step. We passed that homeowner to you.'],
    [{ contacted: 5, replied: 3, asked: 2, passed: 2 }, 'We passed those 2 homeowners to you.'],
    [{ imported: 1, cleared: 0 }, 'We reviewed 1 of your unsold estimate. None could be followed up yet.'],
  ])('%o', (over, expected) => {
    const text = contractorSummary(base(over));
    expect(text).toContain(expected);
    expect(text).not.toMatch(/\b0 (homeowners|replied|confirmed)|those 0/);
  });
  it('on the sample pilot', () => {
    const s = sample();
    const text = contractorSummary(pilotReport(s, s.pilots[0]!.id, TODAY));
    expect(text).toBe('We reviewed 10 of your unsold estimates. 8 could be followed up under the contact permission you gave us. With your approval of every message, we followed up with 2 homeowners. 1 has replied so far.');
  });
});

describe('6. new pilots are email-first and consistent', () => {
  it('default sequence uses only the default approved channels', () => {
    const p = defaultPilotInput(TODAY);
    expect(p.approvedChannels).toEqual(['email']);
    expect(p.sequence.every((st) => p.approvedChannels.includes(st.channel))).toBe(true);
  });
});

describe('7. messages read like a person wrote them', () => {
  it('no internal labels or “+” in homeowner-facing text, scope reads as a line item', () => {
    const s = sample();
    const contractor = s.contractors[0]!;
    const texts = s.records.flatMap((r) => (['initial', 'unanswered', 'final'] as const).flatMap((t) => [draftText(t, 'email', r, contractor), draftText(t, 'sms', r, contractor)]));
    for (const t of texts) {
      expect(t).not.toMatch(/\(sample\)|\(demo\)| \+ |your full replacement/i);
    }
    const mike = s.records.find((r) => r.estimateRef === 'Q-2236')!;
    expect(draftText('initial', 'email', mike, contractor)).toContain('roof estimate we sent you on');
    expect(draftText('initial', 'email', mike, contractor)).toContain('(full replacement plus standing-seam metal accent over porch, $22,000)');
    expect(approvalBatch(s, s.pilots[0]!.id).text).not.toMatch(/\(sample\)/);
  });
});
