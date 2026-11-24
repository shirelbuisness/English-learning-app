import { addDays, isIsoDate } from './dates.ts';
import { contactBlockers, eligibilityBlockers, findPilot, ledgerMatches, permittedChannels } from './eligibility.ts';
import { normalizeEmail, normalizePhone } from './normalize.ts';
import { fail, transact, type Tx } from './state.ts';
import { draftText } from './templates.ts';
import {
  ELIGIBILITY_SHORT,
  HANDOFF_OUTCOME_LABELS,
  OUTCOME_LABELS,
  POSITIVE_OUTCOMES,
  type Authorization,
  type Channel,
  type Clock,
  type EligibilityStatus,
  type EstimateRecord,
  type HandoffOutcome,
  type IsoDate,
  type Outcome,
  type Pilot,
  type RequestKind,
  type Result,
  type SequenceStep,
  type Touch,
  type WorkbenchState,
} from './types.ts';

/* ------------------------------------------------------------------ queries */

export const OPEN_TOUCH: ReadonlySet<Touch['status']> = new Set(['draft', 'awaiting_approval', 'approved']);

export function openTouch(record: EstimateRecord): Touch | undefined {
  return record.touches.find((t) => OPEN_TOUCH.has(t.status));
}

export function contactedTouches(record: EstimateRecord): Touch[] {
  return record.touches.filter((t) => t.status === 'contacted').sort((a, b) => a.step - b.step);
}

export function lastContacted(record: EstimateRecord): Touch | undefined {
  return contactedTouches(record).at(-1);
}

/** A reply that needs operator attention: a response other than no-response/opt-out/decline, not yet qualified or closed. */
export function pendingReply(record: EstimateRecord): Touch | undefined {
  const last = lastContacted(record);
  if (!last?.outcome || record.qualification || record.closed) return undefined;
  return POSITIVE_OUTCOMES.has(last.outcome) || last.outcome === 'other' ? last : undefined;
}

/** The next sequence step that may be drafted, or null when the sequence has stopped or finished. */
export function nextStep(record: EstimateRecord, pilot: Pilot): SequenceStep | null {
  if (record.closed || record.qualification || record.handoff) return null;
  const done = contactedTouches(record);
  const last = done.at(-1);
  if (last && last.outcome !== 'no_response') return null;
  return pilot.sequence[done.length] ?? null;
}

/** When a step becomes due: step 1 immediately; later steps relative to the first contact. */
export function stepDueOn(record: EstimateRecord, pilot: Pilot, step: number, today: IsoDate): IsoDate {
  const firstContact = contactedTouches(record)[0];
  const seq = pilot.sequence.find((s) => s.step === step);
  if (!firstContact?.contactedOn || !seq || step === 1) return today;
  return addDays(firstContact.contactedOn, seq.day - (pilot.sequence[0]?.day ?? 1));
}

export function sequenceComplete(record: EstimateRecord, pilot: Pilot): boolean {
  const done = contactedTouches(record);
  return done.length >= pilot.sequence.length && done.at(-1)?.outcome === 'no_response';
}

/* ------------------------------------------------------------------ helpers */

function getRecord(tx: Tx, recordId: string): EstimateRecord {
  return tx.s.records.find((r) => r.id === recordId) ?? fail('Record not found.');
}

function getPilot(tx: Tx, pilotId: string): Pilot {
  return findPilot(tx.s, pilotId) ?? fail('Pilot not found.');
}

function findTouch(tx: Tx, touchId: string): { record: EstimateRecord; touch: Touch } {
  for (const record of tx.s.records) {
    const touch = record.touches.find((t) => t.id === touchId);
    if (touch) return { record, touch };
  }
  return fail('Draft not found.');
}

/** Record a material change: bumps the version so earlier drafts need re-review before approval. */
function changed(tx: Tx, record: EstimateRecord): void {
  record.version += 1;
  record.updatedAt = tx.clock.now;
}

function ctx(record: EstimateRecord, tx: Tx) {
  const pilot = getPilot(tx, record.pilotId);
  return { pilotId: record.pilotId, recordId: record.id, contractorId: pilot.contractorId };
}

/** Block every open draft/approval on a record (or those matching `which`). Used by every restriction path. */
export function blockOpenTouches(tx: Tx, record: EstimateRecord, reason: string, which: (t: Touch) => boolean = () => true): number {
  let n = 0;
  for (const t of record.touches) {
    if (OPEN_TOUCH.has(t.status) && which(t)) {
      tx.log({ type: 'touch_blocked', ...ctx(record, tx), from: t.status, to: 'blocked', detail: `Step ${t.step} (${t.channel}) blocked: ${reason}` });
      t.status = 'blocked';
      t.blockedReason = reason;
      n++;
    }
  }
  return n;
}

function cancelOpenTouches(tx: Tx, record: EstimateRecord, reason: string): void {
  for (const t of record.touches) {
    if (OPEN_TOUCH.has(t.status)) {
      tx.log({ type: 'touch_cancelled', ...ctx(record, tx), from: t.status, to: 'cancelled', detail: `Step ${t.step} cancelled: ${reason}` });
      t.status = 'cancelled';
      t.blockedReason = reason;
    }
  }
}

export function setEligibilityStatus(tx: Tx, record: EstimateRecord, status: EligibilityStatus, reason: string, source: EstimateRecord['eligibility']['source']): void {
  const from = record.eligibility.status;
  record.eligibility = { status, reason, decidedAt: tx.clock.now, source };
  changed(tx, record);
  tx.log({ type: 'eligibility_changed', ...ctx(record, tx), from, to: status, detail: `${ELIGIBILITY_SHORT[status]} (${source}): ${reason}` });
  if (status !== 'eligible') blockOpenTouches(tx, record, ELIGIBILITY_SHORT[status]);
}

/** Apply suppression to a record and the contractor's ledger. Overrides every active workflow state. */
export function applySuppression(tx: Tx, record: EstimateRecord, reason: string, channel: Channel | 'import' | 'other', date: IsoDate, source: 'operator' | 'homeowner' | 'contractor' | 'ledger' | 'import'): void {
  const pilot = getPilot(tx, record.pilotId);
  if (record.eligibility.status !== 'suppressed') setEligibilityStatus(tx, record, 'suppressed', reason, source);
  if ((record.email || record.phone) && ledgerMatches(tx.s, pilot.contractorId, record.email, record.phone).length === 0) {
    tx.s.suppression.push({
      id: tx.id('sup'),
      contractorId: pilot.contractorId,
      email: record.email,
      phone: record.phone,
      recordId: record.id,
      pilotId: record.pilotId,
      reason,
      channel,
      recordedOn: date,
      active: true,
      reversedAt: null,
      reversalReason: null,
    });
    tx.log({ type: 'suppression_ledger_added', ...ctx(record, tx), detail: `Added to suppression ledger: ${reason}` });
  }
}

/* --------------------------------------------------------------- eligibility */

export function setEligibility(state: WorkbenchState, recordId: string, decision: 'eligible' | 'ineligible' | 'pending_review', reason: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const from = r.eligibility.status;
    if (from === 'suppressed' || from === 'excluded') {
      fail(`This record is ${ELIGIBILITY_SHORT[from].toLowerCase()}. Use the restriction review action, with a reason, to change it.`);
    }
    if (from === decision) fail(`Record is already ${ELIGIBILITY_SHORT[decision].toLowerCase()}.`);
    if (decision === 'eligible') {
      const blockers = eligibilityBlockers(tx.s, r);
      if (blockers.length > 0) fail(`Cannot mark eligible: ${blockers.join('; ')}.`);
    }
    if (decision !== 'eligible' && !reason.trim()) fail('A reason is required.');
    setEligibilityStatus(tx, r, decision, reason.trim() || 'Eligibility confirmed by operator against documented authorization', 'operator');
    return decision === 'eligible' ? 'Marked eligible.' : `Marked ${ELIGIBILITY_SHORT[decision].toLowerCase()}.`;
  });
}

export function excludeRecord(state: WorkbenchState, recordId: string, reason: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    if (!reason.trim()) fail('A reason is required.');
    if (r.eligibility.status === 'suppressed') fail('Record is already suppressed, which is stronger than an exclusion.');
    if (r.eligibility.status === 'excluded') fail('Record is already excluded.');
    setEligibilityStatus(tx, r, 'excluded', reason.trim(), 'contractor');
    return 'Excluded by contractor. Open drafts and approvals are blocked.';
  });
}

export interface SuppressInput {
  reason: string;
  channel: Channel | 'other';
  date: IsoDate;
  source: 'operator' | 'homeowner' | 'contractor';
}

export function suppressRecord(state: WorkbenchState, recordId: string, input: SuppressInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    if (r.eligibility.status === 'suppressed') fail('Record is already suppressed.');
    if (!input.reason.trim()) fail('A reason is required.');
    if (!isIsoDate(input.date) || input.date > clock.today) fail('Enter the date of the request (not in the future).');
    applySuppression(tx, r, input.reason.trim(), input.channel, input.date, input.source);
    if (input.source === 'homeowner') tx.log({ type: 'opt_out_recorded', ...ctx(r, tx), detail: `Opt-out via ${input.channel} on ${input.date}` });
    return 'Suppressed. All outreach for this contact is stopped.';
  });
}

/** Explicit review that lifts a suppression or exclusion. Returns the record to pending review — never straight to eligible. */
export function reviewRestriction(state: WorkbenchState, recordId: string, reason: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const from = r.eligibility.status;
    if (from !== 'suppressed' && from !== 'excluded') fail('Only suppressed or excluded records need a restriction review.');
    if (reason.trim().length < 10) fail('Explain the reason for lifting the restriction (at least 10 characters).');
    if (from === 'suppressed') {
      const pilot = getPilot(tx, r.pilotId);
      for (const e of ledgerMatches(tx.s, pilot.contractorId, r.email, r.phone)) {
        e.active = false;
        e.reversedAt = clock.now;
        e.reversalReason = reason.trim();
      }
      tx.log({ type: 'suppression_reversed', ...ctx(r, tx), from, to: 'pending_review', detail: reason.trim() });
    } else {
      tx.log({ type: 'exclusion_reversed', ...ctx(r, tx), from, to: 'pending_review', detail: reason.trim() });
    }
    setEligibilityStatus(tx, r, 'pending_review', `Restriction lifted: ${reason.trim()}`, 'operator');
    return 'Restriction lifted. The record is back in review; earlier drafts stay blocked.';
  });
}

export interface DetailsInput {
  email: string;
  phone: string;
  authorization: Authorization;
}

/** Edit contact details and authorization evidence. A material change sends an eligible record back to review. */
export function updateRecordDetails(state: WorkbenchState, recordId: string, input: DetailsInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (email.invalid) fail('Email address is not valid.');
    if (phone.invalid) fail('Phone number is not a valid US number.');
    const before = JSON.stringify([r.email, r.phone, r.authorization]);
    r.email = email.value;
    r.phone = phone.value;
    r.authorization = { ...input.authorization };
    if (JSON.stringify([r.email, r.phone, r.authorization]) === before) fail('Nothing changed.');
    changed(tx, r);
    tx.log({ type: 'record_details_updated', ...ctx(r, tx), detail: 'Contact details or authorization evidence edited' });
    const pilot = getPilot(tx, r.pilotId);
    if (ledgerMatches(tx.s, pilot.contractorId, r.email, r.phone).length > 0 && r.eligibility.status !== 'suppressed') {
      setEligibilityStatus(tx, r, 'suppressed', 'Contact matches the suppression ledger', 'ledger');
      return 'Saved. The updated contact matches the suppression ledger, so the record is suppressed.';
    }
    if (r.authorization.priorOptOut && r.eligibility.status !== 'suppressed') {
      applySuppression(tx, r, 'Previous opt-out recorded', 'other', clock.today, 'operator');
      return 'Saved. A previous opt-out was recorded, so the record is suppressed.';
    }
    if (r.eligibility.status === 'eligible') {
      setEligibilityStatus(tx, r, 'pending_review', 'Contact details or authorization changed — re-review required', 'operator');
      return 'Saved. Eligibility must be reviewed again.';
    }
    blockOpenTouches(tx, r, 'Record details changed', (t) => !permittedChannels(r, pilot).includes(t.channel));
    return 'Saved.';
  });
}

/* ------------------------------------------------------------------- drafts */

export function prepareDraft(state: WorkbenchState, recordId: string, clock: Clock, channel?: Channel): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const pilot = getPilot(tx, r.pilotId);
    const contractor = tx.s.contractors.find((c) => c.id === pilot.contractorId) ?? fail('Contractor not found.');
    if (openTouch(r)) fail('This record already has an open draft.');
    if (pendingReply(r)) fail('The homeowner replied — handle the reply before any further outreach.');
    const step = nextStep(r, pilot) ?? fail('No further sequence steps for this record.');
    const permitted = permittedChannels(r, pilot);
    const chosen = channel ?? (permitted.includes(step.channel) ? step.channel : permitted[0]);
    if (!chosen) fail('No permitted channel: needs a pilot-approved channel with documented consent.');
    const blockers = contactBlockers(tx.s, r, chosen).filter((b) => !b.startsWith('Pilot is '));
    if (blockers.length > 0) fail(`Cannot prepare a draft: ${blockers.join('; ')}.`);
    const template = chosen === 'phone' ? 'call_script' : step.channel === 'phone' ? 'unanswered' : step.template;
    const touch: Touch = {
      id: tx.id('tch'),
      step: step.step,
      channel: chosen,
      template,
      draft: draftText(template, chosen, r, contractor),
      preparedAt: clock.now,
      preparedForVersion: r.version,
      status: 'draft',
      submittedAt: null,
      approvedAt: null,
      blockedReason: null,
      contactedOn: null,
      confirmedAt: null,
      outcome: null,
      outcomeRecordedAt: null,
      notes: '',
    };
    r.touches.push(touch);
    tx.log({ type: 'draft_prepared', ...ctx(r, tx), to: 'draft', detail: `Step ${step.step} ${chosen} draft prepared` });
    return `Step ${step.step} draft prepared.`;
  });
}

export function editDraft(state: WorkbenchState, touchId: string, text: string, clock: Clock, channel?: Channel): Result {
  return transact(state, clock, (tx) => {
    const { record, touch } = findTouch(tx, touchId);
    if (touch.status !== 'draft' && touch.status !== 'awaiting_approval') fail(`A ${touch.status.replace('_', ' ')} message cannot be edited.`);
    if (!text.trim()) fail('The message cannot be empty.');
    const pilot = getPilot(tx, record.pilotId);
    if (channel && channel !== touch.channel) {
      if (!permittedChannels(record, pilot).includes(channel)) fail(`${channel} is not permitted for this record.`);
      touch.channel = channel;
    }
    const from = touch.status;
    touch.draft = text;
    touch.preparedForVersion = record.version;
    touch.status = 'draft';
    touch.submittedAt = null;
    tx.log({ type: 'draft_edited', ...ctx(record, tx), from, to: 'draft', detail: `Step ${touch.step} draft edited${from === 'awaiting_approval' ? ' — needs to be resubmitted for approval' : ''}` });
    return from === 'awaiting_approval' ? 'Draft saved. It must be resubmitted for contractor approval.' : 'Draft saved.';
  });
}

export interface BatchOutcome {
  done: { touchId: string; recordId: string; name: string }[];
  blocked: { touchId: string; recordId: string; name: string; reasons: string[] }[];
}

export type BatchResult = ({ ok: true; state: WorkbenchState; message: string } | { ok: false; error: string }) & { batch?: BatchOutcome };

function runBatch(
  state: WorkbenchState,
  touchIds: string[],
  clock: Clock,
  verb: string,
  check: (tx: Tx, record: EstimateRecord, touch: Touch) => string[],
  apply: (tx: Tx, record: EstimateRecord, touch: Touch) => void,
): BatchResult {
  const batch: BatchOutcome = { done: [], blocked: [] };
  if (touchIds.length === 0) return { ok: false, error: 'Select at least one draft.' };
  const result = transact(state, clock, (tx) => {
    for (const id of new Set(touchIds)) {
      let found: { record: EstimateRecord; touch: Touch };
      try {
        found = findTouch(tx, id);
      } catch {
        batch.blocked.push({ touchId: id, recordId: '', name: id, reasons: ['Draft not found'] });
        continue;
      }
      const { record, touch } = found;
      const reasons = check(tx, record, touch);
      if (reasons.length > 0) {
        batch.blocked.push({ touchId: id, recordId: record.id, name: record.customerName, reasons });
        tx.log({ type: `${verb}_blocked`, ...ctx(record, tx), from: touch.status, to: touch.status, detail: `Step ${touch.step}: ${reasons.join('; ')}` });
      } else {
        apply(tx, record, touch);
        batch.done.push({ touchId: id, recordId: record.id, name: record.customerName });
      }
    }
    const n = batch.done.length;
    return `${n} ${verb === 'approval' ? 'approved' : 'submitted'}${batch.blocked.length ? `, ${batch.blocked.length} blocked` : ''}.`;
  });
  return { ...result, batch };
}

/** Mark drafts as sent to the contractor for approval. */
export function submitForApproval(state: WorkbenchState, touchIds: string[], clock: Clock): BatchResult {
  return runBatch(
    state,
    touchIds,
    clock,
    'submission',
    (tx, record, touch) => {
      if (touch.status !== 'draft') return [`Status is "${touch.status.replace('_', ' ')}", not draft`];
      return contactBlockers(tx.s, record, touch.channel).filter((b) => !b.startsWith('Pilot is '));
    },
    (tx, record, touch) => {
      touch.status = 'awaiting_approval';
      touch.submittedAt = tx.clock.now;
      tx.log({ type: 'draft_submitted', ...ctx(record, tx), from: 'draft', to: 'awaiting_approval', detail: `Step ${touch.step} sent to contractor for approval` });
    },
  );
}

/**
 * Record contractor approval. Each draft is revalidated independently right now;
 * failures are not approved and are reported, the rest proceed.
 */
export function approveDrafts(state: WorkbenchState, touchIds: string[], clock: Clock): BatchResult {
  return runBatch(
    state,
    touchIds,
    clock,
    'approval',
    (tx, record, touch) => {
      if (touch.status !== 'awaiting_approval') {
        return [touch.status === 'draft' ? 'Not yet submitted to the contractor' : `Status is "${touch.status.replace('_', ' ')}"`];
      }
      const reasons = contactBlockers(tx.s, record, touch.channel);
      if (touch.preparedForVersion !== record.version) reasons.push('Record changed since the draft was prepared — review and save the draft again');
      if (!touch.draft.trim()) reasons.push('Message is empty');
      return reasons;
    },
    (tx, record, touch) => {
      touch.status = 'approved';
      touch.approvedAt = tx.clock.now;
      tx.log({ type: 'draft_approved', ...ctx(record, tx), from: 'awaiting_approval', to: 'approved', detail: `Step ${touch.step} approved by contractor (not sent)` });
    },
  );
}

/* ----------------------------------------------------------------- outreach */

export interface ContactInput {
  /** The operator must explicitly confirm the communication actually happened. */
  confirmed: boolean;
  contactedOn: IsoDate;
  channel: Channel;
  outcome: Outcome;
  notes: string;
}

export function confirmContact(state: WorkbenchState, touchId: string, input: ContactInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const { record, touch } = findTouch(tx, touchId);
    if (touch.status === 'contacted') fail('This contact attempt has already been recorded.');
    if (touch.status !== 'approved') fail('Only an approved message can be recorded as contacted.');
    if (!input.confirmed) fail('Confirm that the communication actually took place.');
    if (input.channel !== touch.channel) fail(`This step was approved for ${touch.channel}. A different channel needs a new approved draft.`);
    if (!isIsoDate(input.contactedOn) || input.contactedOn > clock.today) fail('Enter the date the contact happened (not in the future).');
    if (touch.approvedAt && input.contactedOn < touch.approvedAt.slice(0, 10)) fail('The contact date is before the approval date.');
    const blockers = contactBlockers(tx.s, record, touch.channel);
    if (blockers.length > 0) fail(`Outreach is blocked: ${blockers.join('; ')}.`);
    touch.status = 'contacted';
    touch.contactedOn = input.contactedOn;
    touch.confirmedAt = clock.now;
    touch.outcome = input.outcome;
    touch.outcomeRecordedAt = clock.now;
    touch.notes = input.notes.trim();
    record.lastContactDate = input.contactedOn;
    record.updatedAt = clock.now;
    tx.log({
      type: 'outreach_confirmed',
      ...ctx(record, tx),
      from: 'approved',
      to: 'contacted',
      detail: `Step ${touch.step} ${touch.channel} contact confirmed for ${input.contactedOn}: ${OUTCOME_LABELS[input.outcome]}${input.notes.trim() ? ` — ${input.notes.trim()}` : ''}`,
    });
    return applyOutcome(tx, record, input.outcome, input.channel, input.contactedOn);
  });
}

export interface ResponseInput {
  outcome: Exclude<Outcome, 'no_response'>;
  date: IsoDate;
  channel: Channel;
  notes: string;
}

/** A homeowner reply that arrives after an attempt was recorded as "no response". */
export function recordResponse(state: WorkbenchState, recordId: string, input: ResponseInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const last = lastContacted(r) ?? fail('No contact attempt has been recorded for this record.');
    if (last.outcome !== 'no_response') fail('A response is already recorded for the latest contact attempt.');
    if (r.qualification || r.closed) fail('This record is already resolved.');
    if (!isIsoDate(input.date) || input.date > clock.today) fail('Enter the date of the response (not in the future).');
    if (last.contactedOn && input.date < last.contactedOn) fail('The response date is before the contact date.');
    last.outcome = input.outcome;
    last.outcomeRecordedAt = clock.now;
    last.notes = [last.notes, input.notes.trim()].filter(Boolean).join(' | ');
    tx.log({ type: 'response_recorded', ...ctx(r, tx), from: 'no_response', to: input.outcome, detail: `${OUTCOME_LABELS[input.outcome]} via ${input.channel} on ${input.date}${input.notes.trim() ? ` — ${input.notes.trim()}` : ''}` });
    cancelOpenTouches(tx, r, 'Homeowner responded');
    return applyOutcome(tx, r, input.outcome, input.channel, input.date);
  });
}

function applyOutcome(tx: Tx, r: EstimateRecord, outcome: Outcome, channel: Channel, date: IsoDate): string {
  switch (outcome) {
    case 'opted_out':
      applySuppression(tx, r, `Homeowner opted out via ${channel} on ${date}`, channel, date, 'homeowner');
      tx.log({ type: 'opt_out_recorded', ...ctx(r, tx), detail: `Opt-out via ${channel} on ${date}` });
      return 'Recorded. Homeowner opted out: the contact is suppressed and outreach has stopped.';
    case 'not_interested':
      r.closed = { at: tx.clock.now, reason: 'Homeowner not interested' };
      cancelOpenTouches(tx, r, 'Homeowner not interested');
      tx.log({ type: 'record_closed', ...ctx(r, tx), detail: 'Homeowner not interested' });
      return 'Recorded. Homeowner not interested: outreach has stopped.';
    case 'wrong_contact':
      r.closed = { at: tx.clock.now, reason: 'Incorrect contact information' };
      setEligibilityStatus(tx, r, 'ineligible', 'Incorrect contact information', 'operator');
      return 'Recorded. Contact details are wrong: the record is ineligible until corrected.';
    case 'no_response':
      return 'Contact recorded: no response.';
    default:
      return `Recorded: ${OUTCOME_LABELS[outcome]}. Review the reply to decide whether it is a qualified re-engagement.`;
  }
}

/* --------------------------------------------------- qualification / closure */

export interface QualifyInput {
  /** Operator confirms the homeowner said the project is unresolved and asked for a next step. */
  confirmed: boolean;
  request: RequestKind;
  notes: string;
}

export function qualifyReengagement(state: WorkbenchState, recordId: string, input: QualifyInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    if (r.qualification) fail('Already recorded as a qualified re-engagement.');
    if (!pendingReply(r)) fail('Only a homeowner reply awaiting review can be qualified.');
    if (!input.confirmed) fail('Confirm the homeowner said the project is unresolved and asked for a next step.');
    r.qualification = { at: clock.now, request: input.request, notes: input.notes.trim() };
    r.updatedAt = clock.now;
    tx.log({ type: 'reengagement_qualified', ...ctx(r, tx), to: 'qualified', detail: `Requested: ${input.request}${input.notes.trim() ? ` — ${input.notes.trim()}` : ''}` });
    return 'Qualified re-engagement recorded. Create the warm handoff next.';
  });
}

export function closeRecord(state: WorkbenchState, recordId: string, reason: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    if (r.closed) fail('Record is already closed.');
    if (r.handoff) fail('A handoff exists; record its outcome instead.');
    if (!reason.trim()) fail('A reason is required.');
    r.closed = { at: clock.now, reason: reason.trim() };
    r.updatedAt = clock.now;
    cancelOpenTouches(tx, r, 'Record closed');
    tx.log({ type: 'record_closed', ...ctx(r, tx), detail: reason.trim() });
    return 'Record closed. No further outreach.';
  });
}

/* ------------------------------------------------------------------ handoffs */

export interface HandoffInput {
  respondedOn: IsoDate;
  homeownerRequest: string;
  conversationNotes: string;
  nextAction: string;
}

export function createHandoff(state: WorkbenchState, recordId: string, input: HandoffInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    if (r.handoff) fail('A handoff already exists for this record.');
    const q = r.qualification ?? fail('Record a qualified re-engagement before creating a handoff.');
    if (!isIsoDate(input.respondedOn) || input.respondedOn > clock.today) fail('Enter the date the homeowner responded.');
    if (!input.homeownerRequest.trim()) fail('Describe what the homeowner requested.');
    if (!input.nextAction.trim()) fail('State the requested next action for the contractor.');
    r.handoff = {
      id: tx.id('hof'),
      createdAt: clock.now,
      respondedOn: input.respondedOn,
      request: q.request,
      homeownerRequest: input.homeownerRequest.trim(),
      conversationNotes: input.conversationNotes.trim(),
      nextAction: input.nextAction.trim(),
      notifiedOn: null,
      acknowledgedOn: null,
      acknowledgementNotes: '',
      outcome: null,
      outcomeOn: null,
      outcomeNotes: '',
      reportedJobValue: null,
    };
    r.updatedAt = clock.now;
    tx.log({ type: 'handoff_created', ...ctx(r, tx), to: 'created', detail: `${input.homeownerRequest.trim()} → ${input.nextAction.trim()}` });
    return 'Warm handoff created. Notify the contractor and record their acknowledgement.';
  });
}

export function markHandoffNotified(state: WorkbenchState, recordId: string, date: IsoDate, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const h = r.handoff ?? fail('No handoff for this record.');
    if (h.notifiedOn) fail('Contractor notification already recorded.');
    if (!isIsoDate(date) || date > clock.today) fail('Enter the date the contractor was notified.');
    if (date < h.createdAt.slice(0, 10)) fail('Notification date is before the handoff was created.');
    h.notifiedOn = date;
    tx.log({ type: 'handoff_notified', ...ctx(r, tx), from: 'created', to: 'notified', detail: `Contractor notified on ${date}` });
    return 'Contractor notification recorded.';
  });
}

export function acknowledgeHandoff(state: WorkbenchState, recordId: string, date: IsoDate, notes: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const h = r.handoff ?? fail('No handoff for this record.');
    if (!h.notifiedOn) fail('Record the contractor notification first.');
    if (h.acknowledgedOn) fail('Acknowledgement already recorded.');
    if (!isIsoDate(date) || date > clock.today || date < h.notifiedOn) fail('Enter the acknowledgement date (on or after notification, not in the future).');
    h.acknowledgedOn = date;
    h.acknowledgementNotes = notes.trim();
    tx.log({ type: 'handoff_acknowledged', ...ctx(r, tx), from: 'notified', to: 'acknowledged', detail: `Contractor acknowledged on ${date}${notes.trim() ? ` — ${notes.trim()}` : ''}` });
    return 'Contractor acknowledgement recorded.';
  });
}

export interface HandoffOutcomeInput {
  outcome: HandoffOutcome;
  date: IsoDate;
  notes: string;
  /** Required for a won job: the contractor confirmed it. */
  verifiedByContractor: boolean;
  jobValue: number | null;
}

export function recordHandoffOutcome(state: WorkbenchState, recordId: string, input: HandoffOutcomeInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const r = getRecord(tx, recordId);
    const h = r.handoff ?? fail('No handoff for this record.');
    if (!h.acknowledgedOn) fail('Outcomes can only be recorded after the contractor acknowledges the handoff.');
    if (h.outcome === input.outcome) fail('That outcome is already recorded.');
    if (!isIsoDate(input.date) || input.date > clock.today || input.date < h.acknowledgedOn) fail('Enter the outcome date (on or after acknowledgement, not in the future).');
    if (input.outcome === 'job_won_verified') {
      if (!input.verifiedByContractor) fail('A won job must be verified by the contractor.');
      if (input.jobValue !== null && !(input.jobValue >= 0)) fail('Job value must be zero or more.');
    }
    const from = h.outcome ?? 'acknowledged';
    h.outcome = input.outcome;
    h.outcomeOn = input.date;
    h.outcomeNotes = input.notes.trim();
    h.reportedJobValue = input.outcome === 'job_won_verified' ? input.jobValue : null;
    tx.log({ type: 'handoff_outcome', ...ctx(r, tx), from, to: input.outcome, detail: `${HANDOFF_OUTCOME_LABELS[input.outcome]} (${input.date})${input.notes.trim() ? ` — ${input.notes.trim()}` : ''}` });
    return 'Contractor-reported outcome recorded.';
  });
}
