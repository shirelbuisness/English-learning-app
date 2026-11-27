/*
 * Workbench entities. Current-state records plus an append-only audit log.
 *
 * Ownership:
 *   Contractor  – the business (name, contact, time zone). Owns the suppression ledger.
 *   Pilot       – one engagement for a contractor: dates, record limit, approved channels,
 *                 communication policy, sequence, economics inputs (hourly cost, revenue).
 *   EstimateRecord – one homeowner estimate inside one pilot, with its eligibility,
 *                 outreach touches, qualification and warm handoff.
 *   SuppressionEntry – contractor-scoped do-not-contact ledger, kept separately from pilot
 *                 records so clearing a pilot cannot re-enable a suppressed contact.
 */

/** Calendar date `YYYY-MM-DD`. */
export type IsoDate = string;
/** Full ISO timestamp. */
export type Timestamp = string;

/** The current moment, passed into every command so the domain never reads the system clock. */
export interface Clock {
  now: Timestamp;
  today: IsoDate;
}

export type Channel = 'email' | 'phone' | 'sms';
export const CHANNELS: readonly Channel[] = ['email', 'phone', 'sms'];
export const CHANNEL_LABELS: Record<Channel, string> = { email: 'Email', phone: 'Phone call', sms: 'Text message' };

export type Consent = 'yes' | 'no' | 'unknown';

export type EstimateStatus = 'open' | 'sold' | 'lost' | 'unknown';
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  open: 'Open (unsold)',
  sold: 'Sold',
  lost: 'Lost',
  unknown: 'Unknown',
};

export type EligibilityStatus = 'pending_review' | 'eligible' | 'ineligible' | 'excluded' | 'suppressed';
export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  pending_review: 'Pending review',
  eligible: 'Eligible (subject to documented authorization)',
  ineligible: 'Ineligible',
  excluded: 'Excluded by contractor',
  suppressed: 'Suppressed / do not contact',
};
export const ELIGIBILITY_SHORT: Record<EligibilityStatus, string> = {
  pending_review: 'Pending review',
  eligible: 'Eligible',
  ineligible: 'Ineligible',
  excluded: 'Excluded',
  suppressed: 'Suppressed',
};

export type DecisionSource = 'import' | 'operator' | 'contractor' | 'homeowner' | 'ledger';

export interface Eligibility {
  status: EligibilityStatus;
  reason: string;
  decidedAt: Timestamp;
  source: DecisionSource;
}

export interface Authorization {
  emailConsent: Consent;
  /** Consent to be called. */
  phoneConsent: Consent;
  /** Consent to receive text messages (separate from calls). */
  smsConsent: Consent;
  /** Free-text description of the evidence (e.g. "Web form consent checkbox, 2026-10-02"). */
  evidence: string;
  /** Where the contact details came from. */
  contactInfoSource: string;
  preferences: string;
  priorOptOut: boolean;
}

export type TemplateKey = 'initial' | 'unanswered' | 'final' | 'call_script';
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  initial: 'Initial estimate follow-up',
  unanswered: 'Follow-up after unanswered message',
  final: 'Final polite follow-up',
  call_script: 'Phone call notes',
};

export interface SequenceStep {
  step: number;
  /** Day of the sequence (Day 1 = first contact). */
  day: number;
  channel: Channel;
  template: TemplateKey;
}

export type TouchStatus = 'draft' | 'awaiting_approval' | 'approved' | 'contacted' | 'blocked' | 'cancelled';
export const TOUCH_STATUS_LABELS: Record<TouchStatus, string> = {
  draft: 'Draft prepared',
  awaiting_approval: 'Awaiting contractor approval',
  approved: 'Approved — not yet contacted',
  contacted: 'Manually contacted',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

export type Outcome =
  | 'no_response'
  | 'interested'
  | 'not_interested'
  | 'callback'
  | 'revised_estimate'
  | 'inspection'
  | 'wrong_contact'
  | 'opted_out'
  | 'other';
export const OUTCOMES: readonly Outcome[] = [
  'no_response',
  'interested',
  'not_interested',
  'callback',
  'revised_estimate',
  'inspection',
  'wrong_contact',
  'opted_out',
  'other',
];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_response: 'No response',
  interested: 'Interested',
  not_interested: 'Not interested',
  callback: 'Requests callback',
  revised_estimate: 'Requests revised estimate',
  inspection: 'Requests inspection',
  wrong_contact: 'Incorrect contact information',
  opted_out: 'Opted out',
  other: 'Other',
};
/** Outcomes where the homeowner actually replied. */
export const REPLY_OUTCOMES: ReadonlySet<Outcome> = new Set([
  'interested',
  'not_interested',
  'callback',
  'revised_estimate',
  'inspection',
  'opted_out',
  'other',
]);
/** Replies that express interest in a next step. Not the same as a qualified re-engagement. */
export const POSITIVE_OUTCOMES: ReadonlySet<Outcome> = new Set(['interested', 'callback', 'revised_estimate', 'inspection']);

export interface Touch {
  id: string;
  step: number;
  channel: Channel;
  template: TemplateKey;
  draft: string;
  preparedAt: Timestamp;
  /** Record version the draft was last reviewed against; approval is blocked if the record changed since. */
  preparedForVersion: number;
  status: TouchStatus;
  submittedAt: Timestamp | null;
  approvedAt: Timestamp | null;
  /** Operator's local calendar day of the approval (date comparisons use local days, not UTC). */
  approvedOn?: IsoDate | null;
  blockedReason: string | null;
  /** Date the operator confirms the communication actually happened. */
  contactedOn: IsoDate | null;
  confirmedAt: Timestamp | null;
  outcome: Outcome | null;
  outcomeRecordedAt: Timestamp | null;
  notes: string;
  /** What the homeowner actually said, and when (kept apart from operator notes). */
  replyText?: string;
  repliedOn?: IsoDate | null;
}

export type RequestKind = 'callback' | 'inspection' | 'revised_estimate' | 'discussion' | 'other';
export const REQUEST_LABELS: Record<RequestKind, string> = {
  callback: 'Callback',
  inspection: 'Inspection',
  revised_estimate: 'Revised estimate',
  discussion: 'Further discussion',
  other: 'Other next step',
};

export interface Qualification {
  at: Timestamp;
  request: RequestKind;
  notes: string;
}

export type HandoffOutcome = 'appointment_reported' | 'job_won_verified' | 'not_proceeding' | 'other';
export const HANDOFF_OUTCOME_LABELS: Record<HandoffOutcome, string> = {
  appointment_reported: 'Appointment / inspection reported by contractor',
  job_won_verified: 'Job won — verified by contractor',
  not_proceeding: 'Not proceeding',
  other: 'Other',
};

export interface Handoff {
  id: string;
  createdAt: Timestamp;
  respondedOn: IsoDate;
  request: RequestKind;
  homeownerRequest: string;
  conversationNotes: string;
  nextAction: string;
  notifiedOn: IsoDate | null;
  acknowledgedOn: IsoDate | null;
  acknowledgementNotes: string;
  outcome: HandoffOutcome | null;
  outcomeOn: IsoDate | null;
  outcomeNotes: string;
  /** Job value reported by the contractor, only for verified wins. */
  reportedJobValue: number | null;
}

export interface EstimateRecord {
  id: string;
  pilotId: string;
  /** The contractor's own estimate/quote number: how the homeowner is found in their CRM or inbox. */
  estimateRef: string | null;
  /** Contractor's context notes, e.g. "Waiting on adjuster", "Getting 2nd bid". */
  notes: string;
  importId: string | null;
  rowNumber: number | null;
  /** The row exactly as imported, for provenance. */
  original: Record<string, string>;
  customerName: string;
  email: string | null;
  phone: string | null;
  estimateDate: IsoDate;
  estimateAmount: number;
  service: string;
  city: string;
  state: string;
  estimateStatus: EstimateStatus;
  lastContactDate: IsoDate | null;
  previousFollowUps: number;
  inquirySource: string;
  /** Estimate age in days on the day it was imported (kept for age-band analysis). */
  ageAtImport: number;
  authorization: Authorization;
  eligibility: Eligibility;
  touches: Touch[];
  qualification: Qualification | null;
  handoff: Handoff | null;
  closed: { at: Timestamp; reason: string } | null;
  /** Incremented when estimate data, contact details, authorization or eligibility change. */
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Contractor {
  id: string;
  businessName: string;
  primaryContact: string;
  email: string;
  phone: string;
  timeZone: string;
  notes: string;
  isDemo: boolean;
  createdAt: Timestamp;
}

/**
 * Where homeowner contact details live.
 * - contractor_system: privacy-safe mode. Only an estimate ID, first name and job details are
 *   tracked here; phone/email stay in the contractor's CRM or inbox, and contact permission rests
 *   on the contractor's recorded attestation for the pilot.
 * - in_workbench: contact details and per-contact consent evidence are imported here.
 */
export type ContactMode = 'contractor_system' | 'in_workbench';
export const CONTACT_MODE_LABELS: Record<ContactMode, string> = {
  contractor_system: "Privacy-safe: contact details stay in the contractor's system",
  in_workbench: 'Contact details and consent evidence imported here',
};

export interface ContractorAttestation {
  /** What the contractor confirmed, in their words or ours, e.g. "All 25 homeowners requested an estimate…". */
  text: string;
  recordedOn: IsoDate;
}

export type PilotStatus = 'setup' | 'active' | 'paused' | 'completed';
export const PILOT_STATUS_LABELS: Record<PilotStatus, string> = {
  setup: 'Setup',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export interface Pilot {
  id: string;
  contractorId: string;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  recordLimit: number;
  approvedChannels: Channel[];
  communicationPolicy: string;
  contactMode: ContactMode;
  contractorAttestation: ContractorAttestation | null;
  sequence: SequenceStep[];
  status: PilotStatus;
  notes: string;
  /** Internal hourly labor cost assumption (USD). */
  hourlyCost: number;
  /** Pilot fee charged to the contractor, entered manually (USD). */
  revenue: number;
  isDemo: boolean;
  createdAt: Timestamp;
}

export interface SuppressionEntry {
  id: string;
  contractorId: string;
  email: string | null;
  phone: string | null;
  estimateRef?: string | null;
  recordId: string | null;
  pilotId: string | null;
  reason: string;
  channel: Channel | 'import' | 'other';
  recordedOn: IsoDate;
  active: boolean;
  reversedAt: Timestamp | null;
  reversalReason: string | null;
}

export interface ImportBatch {
  id: string;
  pilotId: string;
  fileName: string;
  importedAt: Timestamp;
  rows: number;
  imported: number;
  duplicatesSkipped: number;
  duplicatesUpdated: number;
  conflictsSkipped: number;
  inFileDuplicates: number;
  invalid: number;
  excludedByOperator: number;
  suppressedOnImport: number;
}

export type TimeCategory =
  | 'onboarding'
  | 'data_cleanup'
  | 'eligibility_review'
  | 'draft_preparation'
  | 'outreach'
  | 'reply_handling'
  | 'handoffs'
  | 'reporting';
export const TIME_CATEGORIES: readonly TimeCategory[] = [
  'onboarding',
  'data_cleanup',
  'eligibility_review',
  'draft_preparation',
  'outreach',
  'reply_handling',
  'handoffs',
  'reporting',
];
export const TIME_CATEGORY_LABELS: Record<TimeCategory, string> = {
  onboarding: 'Onboarding',
  data_cleanup: 'Data cleanup',
  eligibility_review: 'Eligibility review',
  draft_preparation: 'Draft preparation',
  outreach: 'Outreach',
  reply_handling: 'Reply handling',
  handoffs: 'Handoffs',
  reporting: 'Reporting',
};

export interface TimeEntry {
  id: string;
  pilotId: string;
  category: TimeCategory;
  minutes: number;
  date: IsoDate;
  /** Measured = timed while working; estimated = reconstructed afterwards. */
  basis: 'measured' | 'estimated';
  notes: string;
  createdAt: Timestamp;
}

export interface Expense {
  id: string;
  pilotId: string;
  description: string;
  amount: number;
  date: IsoDate;
  createdAt: Timestamp;
}

export interface AuditEvent {
  id: string;
  at: Timestamp;
  type: string;
  contractorId: string | null;
  pilotId: string | null;
  recordId: string | null;
  from: string | null;
  to: string | null;
  detail: string;
}

export interface WorkbenchState {
  schemaVersion: 2;
  contractors: Contractor[];
  pilots: Pilot[];
  records: EstimateRecord[];
  suppression: SuppressionEntry[];
  imports: ImportBatch[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  events: AuditEvent[];
  /** Monotonic counter for deterministic, collision-free ids. */
  nextId: number;
}

export type Result<T = WorkbenchState> = { ok: true; state: T; message: string } | { ok: false; error: string };

/** Email-first default for new pilots: needs no texting setup (see README, messaging). */
export const EMAIL_FIRST_SEQUENCE: SequenceStep[] = [
  { step: 1, day: 1, channel: 'email', template: 'initial' },
  { step: 2, day: 4, channel: 'email', template: 'unanswered' },
  { step: 3, day: 9, channel: 'email', template: 'final' },
];

export const DEFAULT_SEQUENCE: SequenceStep[] = [
  { step: 1, day: 1, channel: 'email', template: 'initial' },
  { step: 2, day: 4, channel: 'phone', template: 'call_script' },
  { step: 3, day: 9, channel: 'email', template: 'final' },
];
