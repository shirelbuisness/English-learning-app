import { daysBetween, formatShortDate, formatUsd } from './dates.ts';
import { findPilot } from './eligibility.ts';
import { formatPhone } from './normalize.ts';
import { isRestricted, lastContacted, pendingReply, replyTextOf } from './records.ts';
import { CHANNEL_LABELS, OUTCOME_LABELS, type EstimateRecord, type Outcome, type Touch, type WorkbenchState } from './types.ts';

/*
 * Zero-login contractor touchpoints: plain text the operator pastes into a text
 * message or email. Building the text changes nothing; approval is still recorded
 * in the workbench afterwards, with every draft revalidated.
 */

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const ref = (r: EstimateRecord) => r.estimateRef ?? r.id;

export interface ApprovalBatch {
  /** Touches in the batch, in the numbered order shown to the contractor. */
  items: { touchId: string; recordId: string; number: number; status: Touch['status'] }[];
  text: string;
}

/** All prepared drafts (draft or awaiting approval) in a pilot, formatted for a one-word reply. */
export function approvalBatch(state: WorkbenchState, pilotId: string): ApprovalBatch {
  const pilot = findPilot(state, pilotId);
  const contractor = state.contractors.find((c) => c.id === pilot?.contractorId);
  const entries = state.records
    .filter((r) => r.pilotId === pilotId && !isRestricted(r))
    .flatMap((r) => r.touches.filter((t) => t.status === 'draft' || t.status === 'awaiting_approval').map((t) => ({ r, t })))
    .sort((a, b) => ref(a.r).localeCompare(ref(b.r)));
  const items = entries.map((e, i) => ({ touchId: e.t.id, recordId: e.r.id, number: i + 1, status: e.t.status }));
  if (entries.length === 0) return { items, text: '' };

  const lines: string[] = [
    `FOLLOW-UPS FOR YOUR OK — ${contractor?.businessName ?? ''} (${entries.length})`,
    `Reply "Approved" to OK all ${entries.length}, or "Approved except 2" / "Change 3: …".`,
    `Nothing goes out until you reply.`,
    '',
  ];
  for (const { r, t } of entries) {
    const i = entries.findIndex((e) => e.t.id === t.id) + 1;
    lines.push(`${i}) ${ref(r)} · ${firstName(r.customerName)} · ${formatUsd(r.estimateAmount)} · ${CHANNEL_LABELS[t.channel]}`);
    if (r.notes) lines.push(`   Note: ${r.notes}`);
    lines.push(...t.draft.split('\n').map((l) => (l.trim() ? `   ${l}` : '')));
    lines.push('');
  }
  return { items, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n' };
}

const NEXT_ACTION: Partial<Record<Outcome, string>> = {
  callback: 'Call them back today.',
  inspection: 'Call today to book the inspection.',
  revised_estimate: 'Send a revised estimate (or call to confirm the changes first).',
  interested: 'Call today to talk next steps.',
  other: 'Read their reply and call if they want to talk.',
};

/** A short, urgent handoff card for a homeowner who replied or re-engaged. Null if there's nothing to hand off. */
export function warmLeadCard(state: WorkbenchState, recordId: string, today: string): string | null {
  const r = state.records.find((x) => x.id === recordId);
  if (!r || isRestricted(r)) return null;
  const reply = pendingReply(r) ?? (r.qualification || r.handoff ? lastContacted(r) : undefined);
  if (!reply?.outcome) return null;
  const pilot = findPilot(state, r.pilotId);
  const name = firstName(r.customerName);
  const next = r.handoff?.nextAction || (NEXT_ACTION[reply.outcome] ?? 'Call them back today.').replace('them', name);
  const said = (replyTextOf(reply) || r.handoff?.homeownerRequest || OUTCOME_LABELS[reply.outcome]).trim();
  const repliedOn = reply.repliedOn ?? reply.contactedOn;
  const where = [r.city, r.state].filter(Boolean).join(', ');
  const contact =
    pilot?.contactMode === 'in_workbench' && (r.phone || r.email)
      ? `Contact: ${[r.phone ? formatPhone(r.phone) : null, r.email].filter(Boolean).join(' · ')}`
      : `Contact: in your system under ${ref(r)}`;
  return [
    `WARM LEAD — ${name} wants to talk`,
    `${ref(r)} · ${name}${where ? ` · ${where}` : ''}`,
    `Scope: ${r.service || 'Roof estimate'}`,
    `Quote: ${formatUsd(r.estimateAmount)} (sent ${daysBetween(r.estimateDate, today)} days ago)`,
    `${name} replied${repliedOn ? ` ${formatShortDate(repliedOn)}` : ''}: "${said}"`,
    `Next: ${next}`,
    contact,
  ].join('\n');
}
