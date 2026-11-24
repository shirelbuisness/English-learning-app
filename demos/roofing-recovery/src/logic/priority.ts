import { daysBetween, formatDate, formatUsd } from './dates.ts';
import type { Assessment, Factor, IsoDate, Lead, Priority, Situation } from './types.ts';

/**
 * Transparent, rule-based prioritisation. These rules rank which leads the
 * recovery team should review first. They do not predict whether a customer
 * will buy.
 */
export const RULES = {
  /** Wait at least this many days after any contact before following up again. */
  minDaysBetweenContacts: 3,
  /** Stop recommending outreach after this many unanswered follow-ups. */
  maxFollowUps: 4,
  highScore: 6,
  mediumScore: 4,
} as const;

const CLOSED_REASONS: Partial<Record<Lead['status'], string>> = {
  job_booked: 'Job is booked. No follow-up needed.',
  closed_lost: 'Opportunity is closed. The customer chose not to proceed.',
  opted_out: 'Customer asked not to be contacted. Not eligible for follow-up.',
};

function noAction(summary: string, factors: Factor[] = []): Assessment {
  return {
    priority: 'none',
    actionable: false,
    situation: null,
    factors,
    score: 0,
    summary,
    nextAction: 'None',
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function situationOf(lead: Lead): Situation {
  switch (lead.status) {
    case 'customer_replied':
      return 'unanswered_reply';
    case 'estimate_sent':
      return 'estimate_no_response';
    case 'new_inquiry':
      return lead.lastContactDate === null ? 'unanswered_inquiry' : 'stalled_conversation';
    default:
      return 'stalled_conversation';
  }
}

function valueFactor(value: number): Factor {
  const amount = formatUsd(value);
  if (value >= 15_000) return { label: `High-value job (${amount})`, points: 3 };
  if (value >= 8_000) return { label: `Substantial job value (${amount})`, points: 2 };
  if (value >= 3_000) return { label: `Moderate job value (${amount})`, points: 1 };
  return { label: `Smaller job (${amount})`, points: 0 };
}

function stalenessFactor(days: number, sinceWhat: string): Factor {
  if (days > 45) return { label: `${plural(days, 'day')} since ${sinceWhat}: older lead, worth one check-in`, points: 1 };
  if (days >= 7) return { label: `${plural(days, 'day')} since ${sinceWhat}`, points: 2 };
  return { label: `${plural(days, 'day')} since ${sinceWhat}`, points: 1 };
}

function scoreToPriority(score: number): Priority {
  if (score >= RULES.highScore) return 'high';
  if (score >= RULES.mediumScore) return 'medium';
  return 'low';
}

export function assessLead(lead: Lead, asOf: IsoDate): Assessment {
  // 1. Eligibility: resolved or ineligible leads never get a recommendation.
  const closed = CLOSED_REASONS[lead.status];
  if (closed) return noAction(closed);

  const { followUp } = lead;
  if (followUp.outcome === 'appointment') {
    return noAction('Appointment booked after follow-up. Your team takes it from here.');
  }
  if (followUp.outcome === 'replied') {
    return noAction('Customer replied to the follow-up. Passed to your office to respond.');
  }
  if (followUp.state === 'dismissed') {
    return noAction('Recommendation dismissed by the reviewer.');
  }
  if (followUp.state === 'completed') {
    return noAction(`Follow-up completed ${formatDate(followUp.completedOn)}. Waiting for a response.`);
  }

  const lastTouch = lead.lastContactDate ?? lead.receivedDate;
  const daysSince = Math.max(0, daysBetween(lastTouch, asOf));

  // 2. A customer waiting on an answer is always the top priority.
  if (lead.status === 'customer_replied') {
    const factors: Factor[] = [
      { label: `Customer replied ${plural(daysSince, 'day')} ago and has not had an answer (always High)`, points: 5 },
      valueFactor(lead.estimateValue),
    ];
    return {
      priority: 'high',
      actionable: true,
      situation: 'unanswered_reply',
      factors,
      score: factors.reduce((sum, f) => sum + f.points, 0),
      summary: `Customer replied ${plural(daysSince, 'day')} ago and is waiting for an answer.`,
      nextAction: "Respond to the customer's message today",
    };
  }

  // 3. Respect contact limits and spacing.
  if (lead.followUpCount >= RULES.maxFollowUps) {
    return noAction(
      `Contact limit reached: ${plural(lead.followUpCount, 'follow-up')} without a response. No further outreach recommended.`,
    );
  }
  if (lead.lastContactDate !== null && daysSince < RULES.minDaysBetweenContacts) {
    return noAction(`Contacted ${plural(daysSince, 'day')} ago. Wait before the next follow-up.`);
  }

  // 4. Score the remaining open opportunities.
  const situation = situationOf(lead);
  const factors: Factor[] = [valueFactor(lead.estimateValue)];
  let summary: string;
  let nextAction: string;

  if (situation === 'unanswered_inquiry') {
    factors.push({ label: 'Inquiry has never been answered', points: 3 });
    factors.push(stalenessFactor(daysSince, 'the inquiry arrived'));
    summary = `Inquiry received ${plural(daysSince, 'day')} ago has never been answered.`;
    nextAction = 'Send a first response and offer an inspection time';
  } else if (situation === 'estimate_no_response') {
    factors.push({ label: 'Estimate sent, no decision from the customer', points: 2 });
    factors.push(stalenessFactor(daysSince, 'last contact'));
    summary = `${formatUsd(lead.estimateValue)} estimate with no response in ${plural(daysSince, 'day')}`;
    if (lead.followUpCount === 0) {
      factors.push({ label: 'No follow-up made since the estimate', points: 1 });
      summary += ' and no follow-up made.';
      nextAction = 'Send a first follow-up on the estimate';
    } else {
      summary += '.';
      nextAction = 'Send a check-in on the estimate';
    }
  } else {
    factors.push({ label: 'Conversation stalled before an estimate', points: 1 });
    factors.push(stalenessFactor(daysSince, 'last contact'));
    summary = `Conversation stalled ${plural(daysSince, 'day')} ago before an estimate.`;
    nextAction = 'Check in and offer to schedule an inspection';
  }

  if (lead.followUpCount >= 3) {
    factors.push({ label: `Already followed up ${lead.followUpCount} times`, points: -1 });
  }

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { priority: scoreToPriority(score), actionable: true, situation, factors, score, summary, nextAction };
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Sort: priority, then score, then value. */
export function compareByPriority(a: { lead: Lead; assessment: Assessment }, b: { lead: Lead; assessment: Assessment }): number {
  return (
    PRIORITY_ORDER[a.assessment.priority] - PRIORITY_ORDER[b.assessment.priority] ||
    b.assessment.score - a.assessment.score ||
    b.lead.estimateValue - a.lead.estimateValue
  );
}
