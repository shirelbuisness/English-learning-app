import { useState, type ReactNode } from 'react';
import { formatDate, formatTimestamp, formatUsd } from '../domain/dates.ts';
import { contactBlockers, dataIssues, eligibilityBlockers, ledgerMatches, permittedChannels } from '../domain/eligibility.ts';
import { formatPhone } from '../domain/normalize.ts';
import { warmLeadCard } from '../domain/touchpoints.ts';
import { CopyPanel } from './CopyPanel.tsx';
import { prioritize } from '../domain/priority.ts';
import { taskFor, workflowStatus } from '../domain/queue.ts';
import {
  acknowledgeHandoff,
  approveDrafts,
  closeRecord,
  confirmContact,
  createHandoff,
  editDraft,
  excludeRecord,
  isRestricted,
  lastContacted,
  markHandoffNotified,
  nextStep,
  openTouch,
  pendingReply,
  prepareDraft,
  replyTextOf,
  qualifyReengagement,
  recordHandoffOutcome,
  recordResponse,
  reviewRestriction,
  setEligibility,
  stepDueOn,
  submitForApproval,
  suppressRecord,
  updateRecordDetails,
} from '../domain/records.ts';
import {
  CHANNEL_LABELS,
  ELIGIBILITY_LABELS,
  ESTIMATE_STATUS_LABELS,
  HANDOFF_OUTCOME_LABELS,
  OUTCOME_LABELS,
  OUTCOMES,
  POSITIVE_OUTCOMES,
  REQUEST_LABELS,
  TEMPLATE_LABELS,
  type Channel,
  type Consent,
  type EstimateRecord,
  type HandoffOutcome,
  type Outcome,
  type RequestKind,
  type Touch,
} from '../domain/types.ts';
import { href, type Route } from './App.tsx';
import { Badge, Button, Callout, Card, cx, EligibilityBadge, Field, inputClass, PriorityBadge, TouchBadge, WorkflowBadge } from './shared.tsx';
import { now, type Workbench } from './useWorkbench.ts';

type Form = null | 'ineligible' | 'review' | 'exclude' | 'suppress' | 'restriction' | 'details' | 'close' | 'late';

export function RecordPage({ wb, record: r, go }: { wb: Workbench; record: EstimateRecord; go: (r: Route) => void }) {
  const { state } = wb;
  const today = now().today;
  const pilot = state.pilots.find((p) => p.id === r.pilotId)!;
  const contractor = state.contractors.find((c) => c.id === pilot.contractorId)!;
  const pr = prioritize(state, r, today);
  const wf = workflowStatus(state, r);
  const task = taskFor(state, r, today);
  const issues = dataIssues(r, today, pilot.contactMode);
  const blockers = eligibilityBlockers(state, r);
  const permitted = permittedChannels(r, pilot);
  const restricted = r.eligibility.status === 'suppressed' || r.eligibility.status === 'excluded' || r.eligibility.status === 'ineligible';
  const [form, setForm] = useState<Form>(null);
  const events = state.events.filter((e) => e.recordId === r.id).slice().reverse();
  const onLedger = ledgerMatches(state, pilot.contractorId, r);

  return (
    <div className="space-y-4">
      <a href={href({ page: 'records' })} className="text-sm text-slate-600 hover:text-navy-900">← Records · {pilot.name}</a>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-navy-900">{r.customerName}</h1>
            <EligibilityBadge s={r.eligibility.status} />
            <PriorityBadge p={pr.category} />
            <WorkflowBadge s={wf} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {r.estimateRef && <strong className="text-navy-900">{r.estimateRef} · </strong>}{r.service || 'Service not recorded'}{r.city ? ` · ${r.city}${r.state ? `, ${r.state}` : ''}` : ''} · sent {formatDate(r.estimateDate)} ({pr.ageDays} days ago) · <span className="text-slate-400">{r.id}</span>
          </p>
        </div>
        <div className="text-end">
          <div className="text-xs text-slate-500">Estimate amount</div>
          <div className="text-2xl font-semibold tabular-nums text-navy-900">{formatUsd(r.estimateAmount)}</div>
        </div>
      </header>

      {restricted ? (
        <Callout tone="red">
          <strong>{ELIGIBILITY_LABELS[r.eligibility.status]}.</strong> {r.eligibility.reason}. No drafts, approvals or outreach are possible
          {r.eligibility.status === 'ineligible' ? ' until the record is reviewed again.' : '. Lifting this needs a separate restriction review with a reason.'}
        </Callout>
      ) : task ? (
        <Callout tone="navy">
          <strong>Next action:</strong> {nextActionText(task.kind)} <span className="text-slate-600">— {task.detail}</span>
        </Callout>
      ) : (
        <Callout tone="green">No action needed on this record right now.</Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {/* Eligibility */}
          <Card
            title="Eligibility and authorization"
            subtitle="The workbench records evidence and enforces your decisions. It does not make legal determinations."
            tone={r.eligibility.status === 'suppressed' ? 'alert' : undefined}
          >
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-navy-900">
                  {r.eligibility.status === 'eligible' && pilot.contactMode === 'contractor_system' ? 'OK to contact (contractor’s permission)' : ELIGIBILITY_LABELS[r.eligibility.status]}
                </span>
                <span className="text-slate-600">— {r.eligibility.reason}</span>
                <span className="text-xs text-slate-400">({r.eligibility.source}, {formatTimestamp(r.eligibility.decidedAt)})</span>
              </div>
              {onLedger.length > 0 && <Callout tone="red">This contact is on {contractor.businessName}'s suppression ledger ({onLedger.map((e) => e.reason).join('; ')}).</Callout>}
              {r.eligibility.status === 'pending_review' && (
                <div>
                  <div className="text-xs font-medium text-slate-600">Before this record can be marked eligible:</div>
                  {blockers.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 ps-5 text-red-800">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  ) : (
                    <p className="mt-1 text-sage-700">No blockers. Check the evidence below, then mark eligible.</p>
                  )}
                </div>
              )}
              {issues.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-600">Data issues</div>
                  <ul className="mt-1 space-y-0.5">
                    {issues.map((i) => <li key={i.message} className={i.level === 'error' ? 'text-red-800' : 'text-amber-900'}>{i.level === 'error' ? '■' : '▲'} {i.message}</li>)}
                  </ul>
                </div>
              )}
              <div className="text-xs text-slate-600">
                {pilot.contactMode === 'contractor_system' ? 'Allowed channels (approved for this pilot, covered by the contractor’s permission):' : 'Permitted channels (pilot-approved + documented consent + contact detail):'}{' '}
                {permitted.length ? permitted.map((c) => <Badge key={c} tone="green">{CHANNEL_LABELS[c]}</Badge>) : <span className="text-red-800">none</span>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {(r.eligibility.status === 'pending_review' || r.eligibility.status === 'ineligible') && (
                  <Button variant="confirm" onClick={() => wb.run((s, c) => setEligibility(s, r.id, 'eligible', '', c))} title={blockers.join('; ')}>
                    Mark eligible
                  </Button>
                )}
                {(r.eligibility.status === 'pending_review' || r.eligibility.status === 'eligible') && <Button onClick={() => setForm('ineligible')}>Mark ineligible</Button>}
                {r.eligibility.status === 'eligible' && <Button variant="ghost" onClick={() => setForm('review')}>Return to review</Button>}
                {r.eligibility.status !== 'suppressed' && r.eligibility.status !== 'excluded' && <Button onClick={() => setForm('exclude')}>Exclude (contractor)</Button>}
                {r.eligibility.status !== 'suppressed' && <Button variant="danger" onClick={() => setForm('suppress')}>Record opt-out / suppress</Button>}
                {(r.eligibility.status === 'suppressed' || r.eligibility.status === 'excluded') && <Button variant="ghost" onClick={() => setForm('restriction')}>Review restriction…</Button>}
                <Button variant="ghost" onClick={() => setForm('details')}>Edit contact &amp; evidence</Button>
              </div>
              {form === 'ineligible' && <ReasonForm label="Why is this record ineligible?" submit="Mark ineligible" onCancel={() => setForm(null)} onSubmit={(reason) => wb.run((s, c) => setEligibility(s, r.id, 'ineligible', reason, c)).ok && setForm(null)} />}
              {form === 'review' && <ReasonForm label="Why does this need re-review?" submit="Return to review" onCancel={() => setForm(null)} onSubmit={(reason) => wb.run((s, c) => setEligibility(s, r.id, 'pending_review', reason, c)).ok && setForm(null)} />}
              {form === 'exclude' && <ReasonForm label="Contractor's reason for exclusion" submit="Exclude record" onCancel={() => setForm(null)} onSubmit={(reason) => wb.run((s, c) => excludeRecord(s, r.id, reason, c)).ok && setForm(null)} />}
              {form === 'suppress' && <SuppressForm today={today} onCancel={() => setForm(null)} onSubmit={(input) => wb.run((s, c) => suppressRecord(s, r.id, input, c)).ok && setForm(null)} />}
              {form === 'restriction' && (
                <ReasonForm
                  label={`Reason for lifting the ${r.eligibility.status === 'suppressed' ? 'suppression' : 'exclusion'} (audited; the record returns to review, old drafts stay blocked)`}
                  submit="Lift restriction"
                  danger
                  onCancel={() => setForm(null)}
                  onSubmit={(reason) => wb.run((s, c) => reviewRestriction(s, r.id, reason, c)).ok && setForm(null)}
                />
              )}
              {form === 'details' && <DetailsForm record={r} privacySafe={pilot.contactMode === 'contractor_system'} onCancel={() => setForm(null)} onSubmit={(input) => wb.run((s, c) => updateRecordDetails(s, r.id, input, c)).ok && setForm(null)} />}
            </div>
          </Card>

          <OutreachCard wb={wb} record={r} form={form} setForm={setForm} today={today} />
          <ReplyCard wb={wb} record={r} form={form} setForm={setForm} today={today} />
          <HandoffCard key={r.qualification?.at ?? "unqualified"} wb={wb} record={r} today={today} />
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Estimate">
            <dl className="space-y-1.5 text-sm">
              <Row k="Contractor's estimate ID" v={r.estimateRef ?? '—'} />
              <Row k="Contractor notes" v={r.notes || '—'} />
              <Row k="Amount" v={formatUsd(r.estimateAmount)} />
              <Row k="Estimate date" v={`${formatDate(r.estimateDate)} · ${pr.ageDays} days old`} />
              <Row k="Age at import" v={`${r.ageAtImport} days`} />
              <Row k="Status" v={ESTIMATE_STATUS_LABELS[r.estimateStatus]} />
              <Row k="Service" v={r.service || '—'} />
              <Row k="Property" v={`${r.city || '—'}${r.state ? `, ${r.state}` : ''}`} />
              <Row k="Last contact (any)" v={formatDate(r.lastContactDate)} />
              <Row k="Contractor follow-ups before pilot" v={String(r.previousFollowUps)} />
              <Row k="Inquiry source" v={r.inquirySource || '—'} />
            </dl>
          </Card>

          <Card title="Why this priority">
            <p className="text-sm text-slate-700"><PriorityBadge p={pr.category} /> {pr.summary}</p>
            {pr.factors.length > 0 && (
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {pr.factors.map((f) => (
                    <tr key={f.label}><td className="py-1 text-slate-700">{f.label}</td><td className="py-1 text-end tabular-nums">{f.points > 0 ? `+${f.points}` : f.points}</td></tr>
                  ))}
                  <tr><td className="py-1 font-medium">Score (5+ High, 3–4 Medium)</td><td className="py-1 text-end font-semibold tabular-nums">{pr.score}</td></tr>
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-slate-500">Ranks work order only. Not a prediction that the homeowner will buy. The 14–60 day window is a hypothesis under test.</p>
          </Card>

          <Card title={pilot.contactMode === 'contractor_system' ? 'Contact & permission' : 'Contact and authorization evidence'}>
            <dl className="space-y-1.5 text-sm">
              {pilot.contactMode === 'contractor_system' && !r.email && !r.phone ? (
                <Row k="Contact details" v={<span className="text-sage-700">In the contractor’s system{r.estimateRef ? ` under ${r.estimateRef}` : ''}</span>} />
              ) : (
                <>
                  <Row k="Email" v={r.email ?? '—'} />
                  <Row k="Phone" v={formatPhone(r.phone)} />
                </>
              )}
              {pilot.contactMode === 'contractor_system' && (
                <Row k="Permission basis" v={pilot.contractorAttestation ? `Contractor attestation ${formatDate(pilot.contractorAttestation.recordedOn)}` : <span className="text-red-800">No contractor attestation yet</span>} />
              )}
              {pilot.contactMode === 'contractor_system' ? (
                <>
                  {pilot.contractorAttestation && <Row k="What they confirmed" v={<span className="italic">“{pilot.contractorAttestation.text}”</span>} />}
                  {(['email', 'phone', 'sms'] as const)
                    .filter((c) => pilot.approvedChannels.includes(c))
                    .map((c) => (
                      <Row key={c} k={CHANNEL_LABELS[c]} v={<PermissionBadge ok={permitted.includes(c)} declined={(c === 'email' ? r.authorization.emailConsent : c === 'phone' ? r.authorization.phoneConsent : r.authorization.smsConsent) === 'no'} />} />
                    ))}
                  {r.authorization.evidence && <Row k="Extra evidence" v={r.authorization.evidence} />}
                  {r.authorization.preferences && <Row k="Preferences" v={r.authorization.preferences} />}
                  {r.authorization.priorOptOut && <Row k="Earlier opt-out" v={<span className="text-red-800">Yes</span>} />}
                </>
              ) : (
                <>
                  <Row k="Email consent" v={<ConsentBadge c={r.authorization.emailConsent} />} />
                  <Row k="Call consent" v={<ConsentBadge c={r.authorization.phoneConsent} />} />
                  <Row k="Text consent" v={<ConsentBadge c={r.authorization.smsConsent} />} />
                  <Row k="Evidence" v={r.authorization.evidence || <span className="text-red-800">None recorded</span>} />
                  <Row k="Contact info source" v={r.authorization.contactInfoSource || '—'} />
                  <Row k="Preferences" v={r.authorization.preferences || '—'} />
                  <Row k="Prior opt-out" v={r.authorization.priorOptOut ? 'Yes' : 'No'} />
                </>
              )}
            </dl>
            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer select-none">Original import row{r.rowNumber ? ` (row ${r.rowNumber})` : ''}</summary>
              <dl className="mt-2 space-y-0.5">
                {Object.entries(r.original).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-44 shrink-0 font-mono">{k}</dt><dd className="break-all">{v || '—'}</dd></div>)}
              </dl>
            </details>
          </Card>

          <Card title="History" subtitle="Append-only activity log for this record">
            <ol className="max-h-[28rem] space-y-2.5 overflow-y-auto text-sm">
              {events.map((e) => (
                <li key={e.id} className="border-s-2 border-slate-200 ps-3">
                  <div className="text-xs text-slate-500">{formatTimestamp(e.at)} · <span className="font-mono">{e.type}</span>{e.from || e.to ? ` · ${e.from ?? '∅'} → ${e.to ?? '∅'}` : ''}</div>
                  <div className="text-slate-800">{e.detail}</div>
                </li>
              ))}
            </ol>
          </Card>
          <Button variant="ghost" onClick={() => go({ page: 'queue' })}>← Back to queue</Button>
        </div>
      </div>
    </div>
  );
}

function nextActionText(kind: string): string {
  return (
    {
      review: 'Review eligibility and authorization evidence.',
      prepare_draft: 'Prepare the next follow-up draft.',
      finish_draft: 'Finish the draft and mark it sent to the contractor for approval.',
      revise_draft: 'The record changed after approval. Revise the draft and get it approved again before any contact.',
      awaiting_approval: 'Record the contractor’s approval once received.',
      contact_due: 'Contact the homeowner outside this tool, then record the contact.',
      reply: 'Review the homeowner’s reply: qualify it or close the record.',
      create_handoff: 'Create the warm handoff for the contractor.',
      notify_contractor: 'Notify the contractor of the handoff and record it.',
      await_ack: 'Record the contractor’s acknowledgement.',
      await_outcome: 'Ask the contractor for the outcome.',
    } as Record<string, string>
  )[kind] ?? '';
}

/* ------------------------------------------------------------------ outreach */

function OutreachCard({ wb, record: r, form, setForm, today }: { wb: Workbench; record: EstimateRecord; form: Form; setForm: (f: Form) => void; today: string }) {
  const { state } = wb;
  const pilot = state.pilots.find((p) => p.id === r.pilotId)!;
  const open = openTouch(r);
  const step = nextStep(r, pilot);
  const permitted = permittedChannels(r, pilot);
  const last = lastContacted(r);
  const canDraft = !open && step && r.eligibility.status === 'eligible' && !pendingReply(r) && pilot.status !== 'completed';
  const dueOn = step ? stepDueOn(r, pilot, step.step, today) : null;
  const [channel, setChannel] = useState<Channel | ''>('');

  return (
    <Card
      title="Outreach sequence"
      subtitle={`${pilot.sequence.map((s) => `Day ${s.day} ${s.channel}`).join(' · ')} — experimental defaults, only where permitted`}
    >
      <div className="space-y-3">
        <ol className="space-y-2">
          {r.touches.map((t) => (
            <li key={t.id} className={cx('rounded-md border p-3 text-sm', t.status === 'blocked' ? 'border-red-200 bg-red-50/40' : 'border-slate-200')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-navy-900">
                  Step {t.step} · {CHANNEL_LABELS[t.channel]} · <span className="font-normal text-slate-600">{TEMPLATE_LABELS[t.template]}</span>
                </div>
                <TouchBadge s={t.status} />
              </div>
              <TouchTimeline t={t} />
              {t.status === 'blocked' && <p className="mt-1 text-red-800">Blocked: {t.blockedReason}</p>}
              {t.status === 'cancelled' && <p className="mt-1 text-slate-500">Cancelled: {t.blockedReason}</p>}
              {t.id === open?.id ? <OpenTouch wb={wb} record={r} touch={t} today={today} /> : (
                <details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer">Message</summary><pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-700">{t.draft}</pre></details>
              )}
            </li>
          ))}
        </ol>

        {canDraft && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3 text-sm">
            <div className="me-auto">
              <div className="font-medium text-navy-900">Next: step {step!.step} (day {step!.day}, {step!.channel})</div>
              <div className="text-xs text-slate-500">{dueOn && dueOn > today ? `Due ${formatDate(dueOn)}` : 'Due now'}{!permitted.includes(step!.channel) && ` · ${step!.channel} not permitted for this record — another permitted channel will be used`}</div>
            </div>
            <label className="text-xs text-slate-600">
              Channel
              <select className={cx(inputClass, 'mt-1 w-36')} value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
                <option value="">Default</option>
                {permitted.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </label>
            <Button variant="primary" onClick={() => wb.run((s, c) => prepareDraft(s, r.id, c, channel || undefined))}>Prepare draft</Button>
          </div>
        )}
        {!open && !step && r.touches.length === 0 && r.eligibility.status !== 'eligible' && <p className="text-sm text-slate-500">Drafts can be prepared once the record is eligible.</p>}
        {!open && !step && r.touches.length > 0 && <p className="text-sm text-slate-500">No further steps in the sequence for this record.</p>}

        {last?.outcome === 'no_response' && !r.closed && !r.qualification && (
          form === 'late' ? (
            <LateResponseForm today={today} permitted={pilot.approvedChannels} onCancel={() => setForm(null)} onSubmit={(input) => wb.run((s, c) => recordResponse(s, r.id, input, c)).ok && setForm(null)} />
          ) : (
            <Button variant="ghost" onClick={() => setForm('late')}>Record a later reply to step {last.step}…</Button>
          )
        )}
      </div>
    </Card>
  );
}

function TouchTimeline({ t }: { t: Touch }) {
  const parts: string[] = [`Prepared ${formatTimestamp(t.preparedAt)}`];
  if (t.submittedAt) parts.push(`sent for approval ${formatTimestamp(t.submittedAt)}`);
  if (t.approvedAt) parts.push(`approved ${formatTimestamp(t.approvedAt)}`);
  if (t.contactedOn) parts.push(`contacted ${formatDate(t.contactedOn)} (confirmed by operator)`);
  return (
    <div className="mt-0.5 text-xs text-slate-500">
      {parts.join(' · ')}
      {t.outcome && <span className="ms-1 font-medium text-slate-700">· Outcome: {OUTCOME_LABELS[t.outcome]}</span>}
      {t.replyText && <span className="block text-slate-700">They said: “{t.replyText}”</span>}
      {t.notes && t.notes !== t.replyText && <span className="block text-slate-600">Your notes: {t.notes}</span>}
    </div>
  );
}

function OpenTouch({ wb, record: r, touch: t, today }: { wb: Workbench; record: EstimateRecord; touch: Touch; today: string }) {
  const { state } = wb;
  const pilot = state.pilots.find((p) => p.id === r.pilotId)!;
  const [text, setText] = useState(t.draft);
  const dirty = text !== t.draft;
  const editable = t.status === 'draft' || t.status === 'awaiting_approval';
  const blockers = contactBlockers(state, r, t.channel);
  const stale = t.preparedForVersion !== r.version;
  const due = stepDueOn(r, pilot, t.step, today);

  return (
    <div className="mt-2 space-y-2">
      <textarea
        aria-label="Message draft"
        value={text}
        readOnly={!editable && t.status !== 'approved'}
        onChange={(e) => setText(e.target.value)}
        rows={t.channel === 'phone' ? 7 : 9}
        className={cx(inputClass, 'leading-relaxed', !editable && 'bg-slate-50')}
      />
      {stale && editable && <Callout tone="amber">The record changed after this draft was prepared. Review the text and save it again before approval.</Callout>}
      {blockers.length > 0 && <Callout tone="red">Currently blocked: {blockers.join('; ')}.</Callout>}

      {t.status === 'draft' && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty && !stale} onClick={() => wb.run((s, c) => editDraft(s, t.id, text, c))}>Save draft</Button>
          <Button
            variant="primary"
            disabled={dirty || stale}
            title={dirty ? 'Save the draft first' : undefined}
            onClick={() => wb.run((s, c) => submitForApproval(s, [t.id], c))}
          >
            Mark sent to contractor for approval
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setText(t.draft)}>Discard changes</Button>}
        </div>
      )}
      {t.status === 'awaiting_approval' && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={dirty}
            onClick={() => {
              const res = wb.run((s, c) => approveDrafts(s, [t.id], c), { quiet: true });
              if (res.ok && res.batch) {
                if (res.batch.done.length) wb.notify('success', 'Contractor approval recorded. Not sent — contact the homeowner, then record it here.');
                else wb.notify('error', `Not approved: ${res.batch.blocked[0]?.reasons.join('; ')}`);
              }
            }}
          >
            Record contractor approval
          </Button>
          <Button disabled={!dirty} onClick={() => wb.run((s, c) => editDraft(s, t.id, text, c))}>Save edit (needs re-approval)</Button>
        </div>
      )}
      {t.status === 'approved' && stale && (
        <Callout tone="amber">The record changed after this message was approved. It cannot be recorded as contacted until it is revised and approved again.</Callout>
      )}
      {t.status === 'approved' && (
        <div className="flex flex-wrap gap-2">
          <Button variant={stale ? 'primary' : 'ghost'} onClick={() => wb.run((s, c) => editDraft(s, t.id, text, c))}>Revise draft (revokes approval)</Button>
        </div>
      )}
      {t.status === 'approved' && <ContactForm wb={wb} touch={t} today={today} due={due} blocked={stale ? ['Record changed after approval', ...blockers] : blockers} />}
    </div>
  );
}

function ContactForm({ wb, touch: t, today, due, blocked }: { wb: Workbench; touch: Touch; today: string; due: string; blocked: string[] }) {
  const [confirmed, setConfirmed] = useState(false);
  const [date, setDate] = useState(today);
  const [outcome, setOutcome] = useState<Outcome>('no_response');
  const [notes, setNotes] = useState('');
  return (
    <div className="rounded-md border border-navy-100 bg-navy-50/60 p-3">
      <p className="text-sm text-navy-900">
        <strong>Approved, not yet contacted.</strong> {due > today ? `Scheduled for ${formatDate(due)}.` : 'Due now.'} Contact the homeowner by {CHANNEL_LABELS[t.channel].toLowerCase()} outside this tool, then record it.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Date contacted"><input type="date" className={inputClass} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Channel used"><input className={inputClass} value={CHANNEL_LABELS[t.channel]} disabled /></Field>
        <Field label="Outcome">
          <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-3"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened, what the homeowner said" /></Field>
      </div>
      {outcome === 'opted_out' && <p className="mt-2 text-sm text-red-800">Recording an opt-out suppresses this contact for the contractor and stops all outreach.</p>}
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-navy-800" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I confirm this communication actually took place on the date above.</span>
      </label>
      <div className="mt-3">
        {blocked.length > 0 && <p className="mb-2 text-sm text-red-800">Cannot be recorded now: {blocked.join('; ')}.</p>}
        <Button variant="confirm" disabled={!confirmed || blocked.length > 0} onClick={() => wb.run((s, c) => confirmContact(s, t.id, { confirmed, contactedOn: date, channel: t.channel, outcome, notes }, c))}>
          Record completed contact
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- reply & handoff */

function ReplyCard({ wb, record: r, form, setForm, today }: { wb: Workbench; record: EstimateRecord; form: Form; setForm: (f: Form) => void; today: string }) {
  const reply = pendingReply(r);
  const [confirmed, setConfirmed] = useState(false);
  const [request, setRequest] = useState<RequestKind>('callback');
  const [notes, setNotes] = useState('');
  if (!reply && !r.qualification) return null;
  return (
    <Card title="Homeowner reply" subtitle="A reply is not a recovered opportunity. Qualify it only if the homeowner confirmed the project is unresolved and asked for a next step." action={<WarmLeadCopy wb={wb} record={r} />}>
      {r.qualification ? (
        <p className="text-sm text-sage-700">
          <strong>Qualified re-engagement</strong> on {formatTimestamp(r.qualification.at)} — requested {REQUEST_LABELS[r.qualification.request].toLowerCase()}.
          {r.qualification.notes && <span className="text-slate-600"> {r.qualification.notes}</span>}
        </p>
      ) : reply && isRestricted(r) ? (
        <Callout tone="red">
          This record is {r.eligibility.status}. The reply ({OUTCOME_LABELS[reply.outcome!]}) cannot be qualified or handed off unless the restriction is reviewed.
        </Callout>
      ) : reply && !POSITIVE_OUTCOMES.has(reply.outcome!) ? (
        <div className="space-y-3 text-sm">
          <p>
            <Badge tone="amber">{OUTCOME_LABELS[reply.outcome!]}</Badge> to step {reply.step} on {formatDate(reply.contactedOn)}
            {replyTextOf(reply) && <span className="text-slate-700"> — “{replyTextOf(reply)}”</span>}
          </p>
          <p className="text-slate-600">Only a specific positive reply can be qualified. Reclassify this reply, or close the record if it needs no follow-up.</p>
          {form === 'late' ? (
            <LateResponseForm title="Reclassify reply" today={today} permitted={['email', 'phone', 'sms']} onCancel={() => setForm(null)} onSubmit={(input) => wb.run((s, c) => recordResponse(s, r.id, input, c)).ok && setForm(null)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setForm('late')}>Reclassify reply…</Button>
              <Button variant="ghost" onClick={() => setForm('close')}>Close record…</Button>
            </div>
          )}
          {form === 'close' && <ReasonForm label="Why close this record?" submit="Close record" onCancel={() => setForm(null)} onSubmit={(reason) => wb.run((s, c) => closeRecord(s, r.id, reason, c)).ok && setForm(null)} />}
        </div>
      ) : reply ? (
        <div className="space-y-3 text-sm">
          <p>
            <Badge tone="green">{OUTCOME_LABELS[reply.outcome!]}</Badge> to step {reply.step} on {formatDate(reply.contactedOn)}
            {replyTextOf(reply) && <span className="text-slate-700"> — “{replyTextOf(reply)}”</span>}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Homeowner requested">
              <select className={inputClass} value={request} onChange={(e) => setRequest(e.target.value as RequestKind)}>
                {(Object.keys(REQUEST_LABELS) as RequestKind[]).map((k) => <option key={k} value={k}>{REQUEST_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="Notes"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-navy-800" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>The homeowner confirmed the project is still unresolved and asked for this next step.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="confirm" disabled={!confirmed} onClick={() => wb.run((s, c) => qualifyReengagement(s, r.id, { confirmed, request, notes }, c))}>Record qualified re-engagement</Button>
            <Button variant="ghost" onClick={() => setForm('close')}>Not a re-engagement — close…</Button>
          </div>
          {form === 'close' && <ReasonForm label="Why close this record?" submit="Close record" onCancel={() => setForm(null)} onSubmit={(reason) => wb.run((s, c) => closeRecord(s, r.id, reason, c)).ok && setForm(null)} />}
        </div>
      ) : null}
    </Card>
  );
}

function HandoffCard({ wb, record: r, today }: { wb: Workbench; record: EstimateRecord; today: string }) {
  const h = r.handoff;
  const reply = lastContacted(r);
  const [f, setF] = useState({ respondedOn: reply?.contactedOn ?? today, homeownerRequest: r.qualification ? REQUEST_LABELS[r.qualification.request] : '', conversationNotes: reply ? replyTextOf(reply) : '', nextAction: '' });
  const [date, setDate] = useState(today);
  const [ackNotes, setAckNotes] = useState('');
  const [oc, setOc] = useState<{ outcome: HandoffOutcome; notes: string; verified: boolean; value: string }>({ outcome: 'appointment_reported', notes: '', verified: false, value: '' });
  if (!r.qualification) return null;

  if (!h && isRestricted(r)) {
    return <Card title="Warm handoff"><Callout tone="red">This record is {r.eligibility.status}; no handoff can be created.</Callout></Card>;
  }
  if (!h) {
    return (
      <Card title="Create warm handoff" subtitle="Passes the homeowner to the contractor. The contractor has not contacted the homeowner until they confirm it.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Homeowner responded on"><input type="date" className={inputClass} max={today} value={f.respondedOn} onChange={(e) => setF({ ...f, respondedOn: e.target.value })} /></Field>
          <Field label="What the homeowner requested"><input className={inputClass} value={f.homeownerRequest} onChange={(e) => setF({ ...f, homeownerRequest: e.target.value })} /></Field>
          <Field label="Conversation notes" className="sm:col-span-2"><textarea rows={2} className={inputClass} value={f.conversationNotes} onChange={(e) => setF({ ...f, conversationNotes: e.target.value })} /></Field>
          <Field label="Requested next action for the contractor" className="sm:col-span-2"><input className={inputClass} value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} placeholder="e.g. Call to book inspection this week" /></Field>
        </div>
        <div className="mt-3"><Button variant="primary" onClick={() => wb.run((s, c) => createHandoff(s, r.id, f, c))}>Create handoff</Button></div>
      </Card>
    );
  }

  const stage = h.outcome ? 4 : h.acknowledgedOn ? 3 : h.notifiedOn ? 2 : 1;
  const restricted = isRestricted(r);
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">Warm handoff <WarmLeadCopy wb={wb} record={r} /></span>} action={<ol className="flex flex-wrap gap-1 text-xs">{['Created', 'Contractor notified', 'Acknowledged', 'Outcome'].map((s, i) => <li key={s}><Badge tone={i < stage ? 'green' : 'plain'}>{i < stage ? '✓ ' : ''}{s}</Badge></li>)}</ol>}>
      <dl className="space-y-1.5 text-sm">
        <Row k="Homeowner responded" v={formatDate(h.respondedOn)} />
        <Row k="Requested" v={h.homeownerRequest} />
        <Row k="Next action" v={h.nextAction} />
        {h.conversationNotes && <Row k="Notes" v={h.conversationNotes} />}
        <Row k="Contractor notified" v={h.notifiedOn ? formatDate(h.notifiedOn) : <span className="text-amber-900">Not yet</span>} />
        <Row k="Contractor acknowledged" v={h.acknowledgedOn ? `${formatDate(h.acknowledgedOn)}${h.acknowledgementNotes ? ` — ${h.acknowledgementNotes}` : ''}` : <span className="text-amber-900">Not yet</span>} />
        <Row k="Contractor-reported outcome" v={h.outcome ? `${HANDOFF_OUTCOME_LABELS[h.outcome]} (${formatDate(h.outcomeOn)})${h.reportedJobValue ? ` · ${formatUsd(h.reportedJobValue)}` : ''}${h.outcomeNotes ? ` — ${h.outcomeNotes}` : ''}` : '—'} />
      </dl>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {restricted && <Callout tone="red">This record is {r.eligibility.status}. {stage === 1 ? 'Do not pass it to the contractor.' : 'Only the contractor’s acknowledgement and outcome can still be recorded.'}</Callout>}
        {stage === 1 && !restricted && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Notified on"><input type="date" className={inputClass} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Button variant="primary" onClick={() => wb.run((s, c) => markHandoffNotified(s, r.id, date, c))}>Record contractor notified</Button>
          </div>
        )}
        {stage === 2 && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Acknowledged on"><input type="date" className={inputClass} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Notes" className="min-w-48 flex-1"><input className={inputClass} value={ackNotes} onChange={(e) => setAckNotes(e.target.value)} /></Field>
            <Button variant="primary" onClick={() => wb.run((s, c) => acknowledgeHandoff(s, r.id, date, ackNotes, c))}>Record acknowledgement</Button>
          </div>
        )}
        {stage >= 3 && (
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Outcome reported by contractor" className="sm:col-span-2">
              <select className={inputClass} value={oc.outcome} onChange={(e) => setOc({ ...oc, outcome: e.target.value as HandoffOutcome })}>
                {(Object.keys(HANDOFF_OUTCOME_LABELS) as HandoffOutcome[]).map((k) => <option key={k} value={k}>{HANDOFF_OUTCOME_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" className={inputClass} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {oc.outcome === 'job_won_verified' && <Field label="Job value (USD)"><input inputMode="decimal" className={inputClass} value={oc.value} onChange={(e) => setOc({ ...oc, value: e.target.value })} /></Field>}
            <Field label="Notes" className="sm:col-span-4"><input className={inputClass} value={oc.notes} onChange={(e) => setOc({ ...oc, notes: e.target.value })} /></Field>
            {oc.outcome === 'job_won_verified' && (
              <label className="flex items-start gap-2 text-sm sm:col-span-4">
                <input type="checkbox" className="mt-0.5 size-4 accent-navy-800" checked={oc.verified} onChange={(e) => setOc({ ...oc, verified: e.target.checked })} />
                The contractor confirmed this job was won.
              </label>
            )}
            <div className="sm:col-span-4">
              <Button variant="primary" onClick={() => wb.run((s, c) => recordHandoffOutcome(s, r.id, { outcome: oc.outcome, date, notes: oc.notes, verifiedByContractor: oc.verified, jobValue: oc.value.trim() === '' ? null : Number(oc.value.replace(/[$,]/g, '')) }, c))}>
                {h.outcome ? 'Update outcome' : 'Record outcome'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------- forms */

function ReasonForm({ label, submit, onSubmit, onCancel, danger }: { label: string; submit: string; onSubmit: (reason: string) => void; onCancel: () => void; danger?: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <form className="space-y-2 rounded-md bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
      <Field label={label}><input autoFocus className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'primary'}>{submit}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function SuppressForm({ today, onSubmit, onCancel }: { today: string; onSubmit: (i: { reason: string; channel: Channel | 'other'; date: string; source: 'operator' | 'homeowner' | 'contractor' }) => void; onCancel: () => void }) {
  const [f, setF] = useState({ reason: '', channel: 'phone' as Channel | 'other', date: today, source: 'homeowner' as 'operator' | 'homeowner' | 'contractor' });
  return (
    <form className="grid gap-2 rounded-md border border-red-200 bg-red-50/50 p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Reason / request" className="sm:col-span-3"><input autoFocus className={inputClass} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Homeowner asked not to be contacted again" /></Field>
      <Field label="Requested by">
        <select className={inputClass} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as typeof f.source })}>
          <option value="homeowner">Homeowner (opt-out)</option>
          <option value="contractor">Contractor</option>
          <option value="operator">Operator decision</option>
        </select>
      </Field>
      <Field label="Channel">
        <select className={inputClass} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as typeof f.channel })}>
          <option value="phone">Phone</option><option value="email">Email</option><option value="sms">Text</option><option value="other">Other</option>
        </select>
      </Field>
      <Field label="Date of request"><input type="date" max={today} className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <p className="text-xs text-red-900 sm:col-span-3">Suppression blocks every open draft and approval immediately and adds the contact to the contractor's suppression ledger.</p>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" variant="danger">Suppress contact</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function LateResponseForm({ title = 'Record reply', today, permitted, onSubmit, onCancel }: { title?: string; today: string; permitted: Channel[]; onSubmit: (i: { outcome: Exclude<Outcome, 'no_response'>; date: string; channel: Channel; notes: string }) => void; onCancel: () => void }) {
  const [f, setF] = useState({ outcome: 'interested' as Exclude<Outcome, 'no_response'>, date: today, channel: (permitted[0] ?? 'email') as Channel, notes: '' });
  return (
    <form className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <Field label="Reply">
        <select className={inputClass} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value as typeof f.outcome })}>
          {OUTCOMES.filter((o) => o !== 'no_response').map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
        </select>
      </Field>
      <Field label="Date"><input type="date" max={today} className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Via">
        <select className={inputClass} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Channel })}>
          {(['email', 'phone', 'sms'] as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>
      </Field>
      <Field label="Notes" className="sm:col-span-3"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" variant="primary">{title}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function DetailsForm({ record: r, privacySafe, onSubmit, onCancel }: { record: EstimateRecord; privacySafe: boolean; onSubmit: (i: { email: string; phone: string; authorization: EstimateRecord['authorization'] }) => void; onCancel: () => void }) {
  const [email, setEmail] = useState(r.email ?? '');
  const [phone, setPhone] = useState(r.phone ? formatPhone(r.phone) : '');
  const [a, setA] = useState(r.authorization);
  const consent = (key: 'emailConsent' | 'phoneConsent' | 'smsConsent', label: string) => (
    <Field label={label}>
      <select className={inputClass} value={a[key]} onChange={(e) => setA({ ...a, [key]: e.target.value as Consent })}>
        <option value="unknown">Unknown</option><option value="yes">Yes — documented</option><option value="no">No</option>
      </select>
    </Field>
  );
  return (
    <form className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ email, phone, authorization: a }); }}>
      {privacySafe ? (
        <p className="text-xs text-sage-700 sm:col-span-2">Privacy-safe pilot: phone and email stay in the contractor’s system.</p>
      ) : (
        <>
          <Field label="Email"><input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone"><input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </>
      )}
      <Field label="Contact info source"><input className={inputClass} value={a.contactInfoSource} onChange={(e) => setA({ ...a, contactInfoSource: e.target.value })} /></Field>
      {consent('emailConsent', 'Email consent')}
      {consent('phoneConsent', 'Call consent')}
      {consent('smsConsent', 'Text consent')}
      <Field label="Authorization evidence" className="sm:col-span-3"><input className={inputClass} value={a.evidence} onChange={(e) => setA({ ...a, evidence: e.target.value })} placeholder="Describe the evidence: form, date, recording…" /></Field>
      <Field label="Preferences" className="sm:col-span-2"><input className={inputClass} value={a.preferences} onChange={(e) => setA({ ...a, preferences: e.target.value })} /></Field>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="size-4 accent-navy-800" checked={a.priorOptOut} onChange={(e) => setA({ ...a, priorOptOut: e.target.checked })} /> Prior opt-out</label>
      <p className="text-xs text-slate-500 sm:col-span-3">Saving changes on an eligible record sends it back to review. Changes are audited.</p>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" variant="primary">Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PermissionBadge({ ok, declined }: { ok: boolean; declined: boolean }) {
  if (declined) return <Badge tone="red">Homeowner said no</Badge>;
  return ok ? <Badge tone="green">OK — covered by contractor’s permission</Badge> : <Badge tone="amber">Not yet — needs contractor’s permission</Badge>;
}

function ConsentBadge({ c }: { c: Consent }) {
  return <Badge tone={c === 'yes' ? 'green' : c === 'no' ? 'red' : 'amber'}>{c === 'yes' ? 'Yes' : c === 'no' ? 'No' : 'Unknown — no permission'}</Badge>;
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="min-w-0 text-end break-words text-slate-800">{v}</dd>
    </div>
  );
}


/** One-click warm lead card for texting the contractor. Shown only when there is a reply to hand off. */
function WarmLeadCopy({ wb, record }: { wb: Workbench; record: EstimateRecord }) {
  const [open, setOpen] = useState(false);
  const text = warmLeadCard(wb.state, record.id, now().today);
  if (!text) return null;
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Copy warm lead handoff</Button>
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-slate-900/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CopyPanel title={`Warm lead handoff · ${record.customerName}`} text={text} hint="Text this straight to the contractor's phone." onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
