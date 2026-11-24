/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

export type LeadStatus =
  | 'new_inquiry'
  | 'contacted'
  | 'estimate_sent'
  | 'customer_replied'
  | 'job_booked'
  | 'closed_lost'
  | 'opted_out';

export const LEAD_STATUSES: readonly LeadStatus[] = [
  'new_inquiry',
  'contacted',
  'estimate_sent',
  'customer_replied',
  'job_booked',
  'closed_lost',
  'opted_out',
];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new_inquiry: 'New inquiry',
  contacted: 'Contacted',
  estimate_sent: 'Estimate sent',
  customer_replied: 'Customer replied',
  job_booked: 'Job booked',
  closed_lost: 'Closed – lost',
  opted_out: 'Opted out',
};

export type ContactChannel = 'phone' | 'text' | 'email' | 'web form' | 'in person';

export interface ContactEvent {
  date: IsoDate;
  channel: ContactChannel;
  direction: 'inbound' | 'outbound';
  summary: string;
}

/**
 * Review state of the recovery team's follow-up for a lead.
 * open → approved → completed; open/approved → dismissed; dismissed → open.
 */
export type FollowUpState = 'open' | 'approved' | 'completed' | 'dismissed';

/** Illustrative result recorded after a completed follow-up. */
export type FollowUpOutcome = 'none' | 'replied' | 'appointment';

export interface FollowUp {
  state: FollowUpState;
  /** Edited draft text; `null` means the generated suggestion is used. */
  draft: string | null;
  approvedOn: IsoDate | null;
  completedOn: IsoDate | null;
  outcome: FollowUpOutcome;
}

export interface Lead {
  id: string;
  name: string;
  city: string;
  source: string;
  receivedDate: IsoDate;
  service: string;
  estimateValue: number;
  status: LeadStatus;
  lastContactDate: IsoDate | null;
  /** Follow-up attempts made before this review (by the contractor or the team). */
  followUpCount: number;
  phone: string;
  email: string;
  history: ContactEvent[];
  followUp: FollowUp;
}

export type Priority = 'high' | 'medium' | 'low' | 'none';

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No action required',
};

export type Situation =
  | 'unanswered_inquiry'
  | 'estimate_no_response'
  | 'stalled_conversation'
  | 'unanswered_reply';

export const SITUATION_LABELS: Record<Situation, string> = {
  unanswered_inquiry: 'Unanswered inquiries',
  estimate_no_response: 'Estimates awaiting follow-up',
  stalled_conversation: 'Stalled conversations',
  unanswered_reply: 'Customer replies not answered',
};

export interface Factor {
  label: string;
  points: number;
}

export interface Assessment {
  priority: Priority;
  /** True when the lead may receive a follow-up recommendation. */
  actionable: boolean;
  situation: Situation | null;
  factors: Factor[];
  score: number;
  /** One-line summary of why. */
  summary: string;
  nextAction: string;
}
