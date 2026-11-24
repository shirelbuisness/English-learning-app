import { currentDraft, suggestedDraft } from './drafts.ts';
import { assessLead } from './priority.ts';
import type { FollowUp, FollowUpOutcome, IsoDate, Lead } from './types.ts';

/**
 * Follow-up approval workflow. Every transition is validated here; the UI
 * only calls these functions and shows the result. Nothing is ever sent.
 *
 *   open ──approve──▶ approved ──complete──▶ completed ──record outcome──▶ replied / appointment
 *    ▲  ◀──revise────┘   │
 *    │                   ▼
 *    └──reopen── dismissed ◀──dismiss── (open or approved)
 */
export function newFollowUp(): FollowUp {
  return { state: 'open', draft: null, approvedOn: null, completedOn: null, outcome: 'none' };
}

export type TransitionResult = { ok: true; lead: Lead } | { ok: false; error: string };

const fail = (error: string): TransitionResult => ({ ok: false, error });

function requireActionable(lead: Lead, asOf: IsoDate): string | null {
  const a = assessLead(lead, asOf);
  return a.actionable ? null : `No follow-up is recommended for this lead: ${a.summary}`;
}

export function editDraft(lead: Lead, text: string, asOf: IsoDate): TransitionResult {
  if (lead.followUp.state !== 'open') return fail('Only a draft that has not been approved can be edited.');
  const blocked = requireActionable(lead, asOf);
  if (blocked) return fail(blocked);
  const draft = text === suggestedDraft(lead) ? null : text;
  return { ok: true, lead: { ...lead, followUp: { ...lead.followUp, draft } } };
}

export function approveFollowUp(lead: Lead, asOf: IsoDate): TransitionResult {
  if (lead.followUp.state !== 'open') return fail(`Cannot approve: follow-up is already ${lead.followUp.state}.`);
  const blocked = requireActionable(lead, asOf);
  if (blocked) return fail(blocked);
  const draft = currentDraft(lead);
  if (draft.trim().length === 0) return fail('Cannot approve an empty message.');
  return { ok: true, lead: { ...lead, followUp: { ...lead.followUp, state: 'approved', draft, approvedOn: asOf } } };
}

/** Return an approved draft to editing. */
export function reviseFollowUp(lead: Lead): TransitionResult {
  if (lead.followUp.state !== 'approved') return fail('Only an approved follow-up can be returned to editing.');
  return { ok: true, lead: { ...lead, followUp: { ...lead.followUp, state: 'open', approvedOn: null } } };
}

export function completeFollowUp(lead: Lead, asOf: IsoDate): TransitionResult {
  if (lead.followUp.state === 'completed') return fail('This follow-up has already been completed.');
  if (lead.followUp.state !== 'approved') return fail('A follow-up must be approved before it can be marked completed.');
  const blocked = requireActionable(lead, asOf);
  if (blocked) return fail(blocked);
  return {
    ok: true,
    lead: {
      ...lead,
      status: lead.status === 'estimate_sent' ? 'estimate_sent' : 'contacted',
      lastContactDate: asOf,
      followUpCount: lead.followUpCount + 1,
      history: [
        ...lead.history,
        {
          date: asOf,
          channel: 'text',
          direction: 'outbound',
          summary: 'Follow-up sent by the recovery team using the approved message. (Demo: logged only — nothing was sent.)',
        },
      ],
      followUp: { ...lead.followUp, state: 'completed', completedOn: asOf },
    },
  };
}

export function dismissFollowUp(lead: Lead): TransitionResult {
  const { state } = lead.followUp;
  if (state !== 'open' && state !== 'approved') return fail(`Cannot dismiss a follow-up that is ${state}.`);
  return { ok: true, lead: { ...lead, followUp: { ...lead.followUp, state: 'dismissed', approvedOn: null } } };
}

export function reopenFollowUp(lead: Lead): TransitionResult {
  if (lead.followUp.state !== 'dismissed') return fail('Only a dismissed recommendation can be restored.');
  return { ok: true, lead: { ...lead, followUp: { ...lead.followUp, state: 'open' } } };
}

const OUTCOME_RANK: Record<FollowUpOutcome, number> = { none: 0, replied: 1, appointment: 2 };

/** Record an illustrative result of a completed follow-up. An appointment implies a reply. */
export function recordOutcome(lead: Lead, outcome: Exclude<FollowUpOutcome, 'none'>, asOf: IsoDate): TransitionResult {
  if (lead.followUp.state !== 'completed') return fail('Results can only be recorded after the follow-up is completed.');
  if (OUTCOME_RANK[outcome] <= OUTCOME_RANK[lead.followUp.outcome]) {
    return fail(outcome === 'replied' ? 'A reply has already been recorded.' : 'An appointment has already been recorded.');
  }
  const summary =
    outcome === 'replied'
      ? 'Customer replied to the follow-up. Passed to your office.'
      : 'Appointment booked with the customer after the follow-up.';
  return {
    ok: true,
    lead: {
      ...lead,
      history: [...lead.history, { date: asOf, channel: 'text', direction: 'inbound', summary }],
      followUp: { ...lead.followUp, outcome },
    },
  };
}
