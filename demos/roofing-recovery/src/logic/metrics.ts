import { assessLead, compareByPriority } from './priority.ts';
import type { Assessment, IsoDate, Lead, Priority, Situation } from './types.ts';

export interface AssessedLead {
  lead: Lead;
  assessment: Assessment;
}

export function assessAll(leads: readonly Lead[], asOf: IsoDate): AssessedLead[] {
  return leads.map((lead) => ({ lead, assessment: assessLead(lead, asOf) }));
}

const RESOLVED: ReadonlySet<Lead['status']> = new Set(['job_booked', 'closed_lost', 'opted_out']);

interface CountValue {
  count: number;
  value: number;
}

const tally = (items: readonly AssessedLead[]): CountValue => ({
  count: items.length,
  value: items.reduce((sum, i) => sum + i.lead.estimateValue, 0),
});

/**
 * Every figure shown on the dashboard and in reporting is computed here from
 * the same lead list. Values are *potential* job values, never revenue.
 */
export function computeMetrics(leads: readonly Lead[], asOf: IsoDate) {
  const assessed = assessAll(leads, asOf);
  const open = assessed.filter((a) => !RESOLVED.has(a.lead.status));
  // Needs follow-up: an actionable recommendation not yet completed or dismissed.
  const needsFollowUp = assessed.filter((a) => a.assessment.actionable).sort(compareByPriority);

  const byPriority = (p: Priority) => tally(assessed.filter((a) => a.assessment.priority === p));
  const bySituation = (s: Situation) => tally(needsFollowUp.filter((a) => a.assessment.situation === s));
  const withState = (s: Lead['followUp']['state']) => assessed.filter((a) => a.lead.followUp.state === s);

  const completed = withState('completed');
  const replied = completed.filter((a) => a.lead.followUp.outcome !== 'none');
  const appointments = completed.filter((a) => a.lead.followUp.outcome === 'appointment');

  return {
    leadsReviewed: assessed.length,
    openOpportunities: tally(open),
    needsFollowUp: tally(needsFollowUp),
    priorityQueue: needsFollowUp,
    priority: {
      high: byPriority('high'),
      medium: byPriority('medium'),
      low: byPriority('low'),
      none: byPriority('none'),
    },
    situations: {
      unanswered_inquiry: bySituation('unanswered_inquiry'),
      estimate_no_response: bySituation('estimate_no_response'),
      stalled_conversation: bySituation('stalled_conversation'),
      unanswered_reply: bySituation('unanswered_reply'),
    } satisfies Record<Situation, CountValue>,
    awaitingReview: tally(withState('open').filter((a) => a.assessment.actionable)),
    approved: tally(withState('approved')),
    completed: tally(completed),
    dismissed: tally(withState('dismissed')),
    replies: tally(replied),
    appointments: tally(appointments),
    completedList: completed,
  };
}

export type Metrics = ReturnType<typeof computeMetrics>;
