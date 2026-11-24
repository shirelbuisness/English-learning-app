import { daysBetween, formatUsd } from './dates.ts';
import { dataIssues, eligibilityBlockers } from './eligibility.ts';
import { contactedTouches } from './records.ts';
import { ELIGIBILITY_SHORT, type EstimateRecord, type WorkbenchState } from './types.ts';

/*
 * Transparent, rule-based prioritisation of which estimates to work first.
 * It ranks work; it does not predict whether a homeowner will buy.
 * The 14–60 day window is an initial hypothesis under test, not an established optimum.
 */
export const PRIORITY_RULES = {
  windowMinDays: 14,
  windowMaxDays: 60,
  /** Before our sequence starts, skip records the contractor contacted this recently. */
  recentContactDays: 7,
  highScore: 5,
  mediumScore: 3,
} as const;

export type PriorityCategory = 'high' | 'medium' | 'low' | 'none' | 'review';
export const PRIORITY_LABELS: Record<PriorityCategory, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No action',
  review: 'Requires review',
};
export const PRIORITY_ORDER: Record<PriorityCategory, number> = { review: 0, high: 1, medium: 2, low: 3, none: 4 };

export interface Factor {
  label: string;
  points: number;
}

export interface PriorityResult {
  category: PriorityCategory;
  summary: string;
  factors: Factor[];
  score: number;
  ageDays: number;
}

export function prioritize(state: WorkbenchState, record: EstimateRecord, today: string): PriorityResult {
  const ageDays = daysBetween(record.estimateDate, today);
  const none = (summary: string): PriorityResult => ({ category: 'none', summary, factors: [], score: 0, ageDays });
  const status = record.eligibility.status;

  // Restrictions and resolutions first: they override everything else.
  if (status === 'suppressed' || status === 'excluded' || status === 'ineligible') {
    return none(`${ELIGIBILITY_SHORT[status]}: ${record.eligibility.reason}`);
  }
  if (record.estimateStatus === 'sold' || record.estimateStatus === 'lost') return none(`Estimate ${record.estimateStatus}`);
  if (record.closed) return none(`Closed: ${record.closed.reason}`);
  if (record.handoff) return none('Handed off to contractor');
  if (record.qualification) return none('Qualified re-engagement — create the handoff');

  if (status === 'pending_review') {
    // Blockers to eligibility, plus any data error they don't already cover (e.g. future dates).
    const blockers = eligibilityBlockers(state, record);
    const extra = dataIssues(record, today).filter((i) => i.level === 'error' && /future/.test(i.message)).map((i) => i.message);
    const unique = [...blockers, ...extra];
    return {
      category: 'review',
      summary: unique.length ? unique.join('; ') : 'Eligibility decision required',
      factors: [],
      score: 0,
      ageDays,
    };
  }

  const inSequence = contactedTouches(record).length > 0;
  if (!inSequence) {
    if (ageDays < PRIORITY_RULES.windowMinDays) return none(`Estimate is ${ageDays} days old — the window starts at ${PRIORITY_RULES.windowMinDays} days`);
    if (record.lastContactDate) {
      const since = daysBetween(record.lastContactDate, today);
      if (since < PRIORITY_RULES.recentContactDays) return none(`Contractor contacted the homeowner ${since} day(s) ago`);
    }
  }

  const factors: Factor[] = [];
  const amt = record.estimateAmount;
  if (amt >= 15_000) factors.push({ label: `Substantial estimate (${formatUsd(amt)})`, points: 3 });
  else if (amt >= 8_000) factors.push({ label: `Mid-size estimate (${formatUsd(amt)})`, points: 2 });
  else if (amt >= 3_000) factors.push({ label: `Moderate estimate (${formatUsd(amt)})`, points: 1 });
  else factors.push({ label: `Smaller estimate (${formatUsd(amt)})`, points: 0 });

  if (ageDays <= 30) factors.push({ label: `${ageDays} days old (14–30)`, points: 2 });
  else if (ageDays <= PRIORITY_RULES.windowMaxDays) factors.push({ label: `${ageDays} days old (31–60)`, points: 1 });
  else factors.push({ label: `${ageDays} days old — outside the 14–60 day window`, points: 0 });

  if (record.previousFollowUps === 0) factors.push({ label: 'No follow-up by the contractor', points: 1 });
  else if (record.previousFollowUps >= 3) factors.push({ label: `Contractor already followed up ${record.previousFollowUps} times`, points: -1 });
  else factors.push({ label: `Contractor followed up ${record.previousFollowUps} time(s), no resolution`, points: 0 });

  const score = factors.reduce((s, f) => s + f.points, 0);
  let category: PriorityCategory = score >= PRIORITY_RULES.highScore ? 'high' : score >= PRIORITY_RULES.mediumScore ? 'medium' : 'low';
  if (ageDays > PRIORITY_RULES.windowMaxDays) category = 'low';
  const summary =
    category === 'high'
      ? 'Eligible, substantial estimate, unresolved'
      : category === 'medium'
        ? 'Eligible, unresolved, some earlier contact or lower value'
        : ageDays > PRIORITY_RULES.windowMaxDays
          ? 'Older than the test window'
          : 'Lower-value or heavily followed-up estimate';
  return { category, summary, factors, score, ageDays };
}
