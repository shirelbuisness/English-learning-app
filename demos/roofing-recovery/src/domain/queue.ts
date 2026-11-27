import { prioritize, PRIORITY_ORDER, type PriorityCategory } from './priority.ts';
import { contactedTouches, isRestricted, nextStep, openTouch, pendingReply, replyTextOf, sequenceComplete, stepDueOn } from './records.ts';
import { findPilot } from './eligibility.ts';
import { OUTCOME_LABELS, type EstimateRecord, type IsoDate, type WorkbenchState } from './types.ts';

/*
 * The operator's single prioritised action queue. Groups are fixed and ordered;
 * secondary distinctions are filters, not separate dashboards.
 */
export type TaskKind =
  | 'review'
  | 'prepare_draft'
  | 'finish_draft'
  | 'revise_draft'
  | 'awaiting_approval'
  | 'contact_due'
  | 'reply'
  | 'create_handoff'
  | 'notify_contractor'
  | 'await_ack'
  | 'await_outcome';

export const QUEUE_GROUPS = [
  { id: 1, label: 'Review records' },
  { id: 2, label: 'Drafts & contractor approval' },
  { id: 3, label: 'Approved follow-ups due' },
  { id: 4, label: 'Homeowner replies' },
  { id: 5, label: 'Warm handoffs' },
] as const;

const TASKS: Record<TaskKind, { group: number; label: string }> = {
  review: { group: 1, label: 'Review eligibility' },
  prepare_draft: { group: 2, label: 'Prepare draft' },
  finish_draft: { group: 2, label: 'Finish draft & submit for approval' },
  revise_draft: { group: 2, label: 'Revise draft — record changed after approval' },
  awaiting_approval: { group: 2, label: 'Record contractor approval' },
  contact_due: { group: 3, label: 'Contact homeowner & confirm' },
  reply: { group: 4, label: 'Review reply' },
  create_handoff: { group: 4, label: 'Create warm handoff' },
  notify_contractor: { group: 5, label: 'Notify contractor' },
  await_ack: { group: 5, label: 'Record contractor acknowledgement' },
  await_outcome: { group: 5, label: 'Ask contractor for outcome' },
};

export interface QueueItem {
  key: string;
  kind: TaskKind;
  group: number;
  label: string;
  detail: string;
  recordId: string;
  pilotId: string;
  contractorId: string;
  touchId: string | null;
  dueOn: IsoDate | null;
  priority: PriorityCategory;
}

export function taskFor(state: WorkbenchState, r: EstimateRecord, today: IsoDate): Omit<QueueItem, 'key' | 'group' | 'label' | 'pilotId' | 'contractorId' | 'recordId'> | null {
  const pilot = findPilot(state, r.pilotId);
  if (!pilot || pilot.status === 'completed') return null;
  const pr = prioritize(state, r, today);
  const base = { touchId: null as string | null, dueOn: null as string | null, priority: pr.category };

  // Restrictions override every workflow state. A handoff the contractor already has
  // can still be acknowledged and closed out; nothing else surfaces.
  if (isRestricted(r)) {
    const h = r.handoff;
    if (h?.notifiedOn && !h.acknowledgedOn) return { ...base, kind: 'await_ack', detail: `Record is ${r.eligibility.status} — record acknowledgement only` };
    if (h?.acknowledgedOn && !h.outcome) return { ...base, kind: 'await_outcome', detail: `Record is ${r.eligibility.status} — record outcome only` };
    return null;
  }
  if (r.handoff) {
    const h = r.handoff;
    if (!h.notifiedOn) return { ...base, kind: 'notify_contractor', detail: `${h.homeownerRequest} → ${h.nextAction}`, dueOn: h.respondedOn };
    if (!h.acknowledgedOn) return { ...base, kind: 'await_ack', detail: `Notified ${h.notifiedOn}; no acknowledgement yet`, dueOn: h.notifiedOn };
    if (!h.outcome) return { ...base, kind: 'await_outcome', detail: `Acknowledged ${h.acknowledgedOn}`, dueOn: h.acknowledgedOn };
    return null;
  }
  if (r.qualification) return { ...base, kind: 'create_handoff', detail: `Homeowner requested: ${r.qualification.request.replace('_', ' ')}` };
  const reply = pendingReply(r);
  if (reply) {
    const said = replyTextOf(reply);
    return { ...base, kind: 'reply', detail: `${OUTCOME_LABELS[reply.outcome!]}${said ? `: “${said}”` : ''}`, dueOn: reply.repliedOn ?? reply.contactedOn };
  }
  if (r.eligibility.status === 'pending_review') return { ...base, kind: 'review', detail: pr.summary };
  if (r.eligibility.status !== 'eligible' || r.closed) return null;

  const open = openTouch(r);
  if (open) {
    const due = stepDueOn(r, pilot, open.step, today);
    if (open.status === 'draft') return { ...base, kind: 'finish_draft', touchId: open.id, dueOn: due, detail: `Step ${open.step} · ${open.channel}` };
    if (open.status === 'awaiting_approval') return { ...base, kind: 'awaiting_approval', touchId: open.id, dueOn: due, detail: `Step ${open.step} · ${open.channel} · sent to contractor` };
    if (open.status === 'approved') {
      if (open.preparedForVersion !== r.version) return { ...base, kind: 'revise_draft', touchId: open.id, dueOn: due, detail: `Step ${open.step} · approved before the record changed — revise and re-approve` };
      if (due > today) return null; // scheduled, not yet due
      return { ...base, kind: 'contact_due', touchId: open.id, dueOn: due, detail: `Step ${open.step} · ${open.channel} · approved, not yet contacted` };
    }
  }
  if (pr.category === 'none') return null;
  const step = nextStep(r, pilot);
  if (!step) return null;
  const due = stepDueOn(r, pilot, step.step, today);
  if (due > today) return null;
  return { ...base, kind: 'prepare_draft', dueOn: due, detail: `Step ${step.step} (day ${step.day}) · ${pr.summary}` };
}

export interface QueueFilter {
  contractorId?: string;
  pilotId?: string;
  priority?: PriorityCategory;
  group?: number;
  due?: 'overdue' | 'today' | 'week';
}

export function buildQueue(state: WorkbenchState, today: IsoDate, filter: QueueFilter = {}): QueueItem[] {
  const items: QueueItem[] = [];
  for (const r of state.records) {
    const pilot = findPilot(state, r.pilotId);
    if (!pilot) continue;
    if (filter.pilotId && r.pilotId !== filter.pilotId) continue;
    if (filter.contractorId && pilot.contractorId !== filter.contractorId) continue;
    const t = taskFor(state, r, today);
    if (!t) continue;
    const meta = TASKS[t.kind];
    const item: QueueItem = { ...t, key: `${r.id}:${t.kind}`, group: meta.group, label: meta.label, recordId: r.id, pilotId: r.pilotId, contractorId: pilot.contractorId };
    if (filter.priority && item.priority !== filter.priority) continue;
    if (filter.group && item.group !== filter.group) continue;
    if (filter.due) {
      if (!item.dueOn) continue;
      if (filter.due === 'overdue' && !(item.dueOn < today)) continue;
      if (filter.due === 'today' && item.dueOn !== today) continue;
      if (filter.due === 'week' && item.dueOn > addWeek(today)) continue;
    }
    items.push(item);
  }
  return items.sort(
    (a, b) =>
      a.group - b.group ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
      a.recordId.localeCompare(b.recordId),
  );
}

function addWeek(d: IsoDate): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------- record workflow status */

export type WorkflowStatus =
  | 'needs_review'
  | 'restricted'
  | 'ready'
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'in_sequence'
  | 'reply'
  | 'qualified'
  | 'handoff'
  | 'handoff_acknowledged'
  | 'outcome_reported'
  | 'sequence_complete'
  | 'closed';

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  needs_review: 'Needs review',
  restricted: 'Blocked',
  ready: 'Ready for draft',
  draft: 'Draft prepared',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved — not contacted',
  in_sequence: 'Contacted — waiting',
  reply: 'Response received',
  qualified: 'Qualified re-engagement',
  handoff: 'Handoff created',
  handoff_acknowledged: 'Contractor acknowledged',
  outcome_reported: 'Outcome reported',
  sequence_complete: 'Completed — no response',
  closed: 'Completed',
};

export function workflowStatus(state: WorkbenchState, r: EstimateRecord): WorkflowStatus {
  if (isRestricted(r) && !r.handoff) return 'restricted';
  if (r.handoff) return r.handoff.outcome ? 'outcome_reported' : r.handoff.acknowledgedOn ? 'handoff_acknowledged' : 'handoff';
  if (r.qualification) return 'qualified';
  if (pendingReply(r)) return 'reply';
  if (r.eligibility.status === 'suppressed' || r.eligibility.status === 'excluded' || r.eligibility.status === 'ineligible') return 'restricted';
  if (r.closed) return 'closed';
  if (r.eligibility.status === 'pending_review') return 'needs_review';
  const open = openTouch(r);
  if (open) return open.status as 'draft' | 'awaiting_approval' | 'approved';
  const pilot = findPilot(state, r.pilotId);
  if (pilot && sequenceComplete(r, pilot)) return 'sequence_complete';
  return contactedTouches(r).length > 0 ? 'in_sequence' : 'ready';
}
