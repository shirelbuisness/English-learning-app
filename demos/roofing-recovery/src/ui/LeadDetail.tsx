import type { ReactNode } from 'react';
import { daysBetween, DEMO_AS_OF, formatDate, formatUsd } from '../logic/dates.ts';
import { currentDraft, suggestedDraft } from '../logic/drafts.ts';
import { assessLead, RULES } from '../logic/priority.ts';
import type { Lead } from '../logic/types.ts';
import {
  approveFollowUp,
  completeFollowUp,
  dismissFollowUp,
  editDraft,
  recordOutcome,
  reopenFollowUp,
  reviseFollowUp,
  type TransitionResult,
} from '../logic/workflow.ts';
import { Button, Card, PriorityBadge, StatusBadge, cx } from './shared.tsx';

type Apply = (leadId: string, t: (lead: Lead) => TransitionResult, successText?: string) => void;

export function LeadDetail({ lead, onBack, backLabel, apply }: { lead: Lead; onBack: () => void; backLabel: string; apply: Apply }) {
  const a = assessLead(lead, DEMO_AS_OF);
  const ageDays = daysBetween(lead.receivedDate, DEMO_AS_OF);

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-slate-600 hover:text-navy-900">
        ← {backLabel}
      </button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-navy-900">{lead.name}</h1>
            <PriorityBadge priority={a.priority} />
            <StatusBadge status={lead.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {lead.service} · {lead.city} · <span className="text-slate-400">{lead.id}</span>
          </p>
        </div>
        <div className="text-end">
          <div className="text-xs font-medium text-slate-500">Estimated job value</div>
          <div className="text-2xl font-semibold tabular-nums text-navy-900">{formatUsd(lead.estimateValue)}</div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-sm sm:grid-cols-4">
        <Fact label="Lead source" value={lead.source} />
        <Fact label="Received" value={`${formatDate(lead.receivedDate)} (${ageDays} days ago)`} />
        <Fact label="Last contact" value={lead.lastContactDate ? formatDate(lead.lastContactDate) : 'Never contacted'} alert={!lead.lastContactDate} />
        <Fact label="Previous follow-ups" value={String(lead.followUpCount)} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <Card title="Why this lead was flagged" subtitle="Fixed review rules. This is not a prediction of whether the customer will buy.">
            <p className={cx('text-base font-medium', a.actionable ? 'text-navy-900' : 'text-slate-600')}>{a.summary}</p>
            {a.factors.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {a.factors.map((f) => (
                    <tr key={f.label}>
                      <td className="py-2 text-slate-700">{f.label}</td>
                      <td className={cx('py-2 text-end tabular-nums font-medium', f.points < 0 ? 'text-red-800' : 'text-navy-900')}>
                        {f.points > 0 ? `+${f.points}` : f.points}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300">
                    <td className="py-2 font-medium text-navy-900">Review score → priority</td>
                    <td className="py-2 text-end font-semibold tabular-nums text-navy-900">{a.score}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer select-none hover:text-navy-900">How priority is decided</summary>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                <li>Booked, closed and opted-out leads are never contacted.</li>
                <li>A customer reply that has not been answered is always High.</li>
                <li>No follow-up within {RULES.minDaysBetweenContacts} days of the last contact, and none after {RULES.maxFollowUps} unanswered follow-ups.</li>
                <li>Otherwise points for job value, situation, time since last contact and history: {RULES.highScore}+ High, {RULES.mediumScore}–{RULES.highScore - 1} Medium, below {RULES.mediumScore} Low.</li>
              </ul>
            </details>
          </Card>

          <FollowUpPanel lead={lead} actionable={a.actionable} nextAction={a.nextAction} apply={apply} />
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="Customer">
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={lead.name} />
              <Row label="Location" value={lead.city} />
              <Row label="Phone" value={lead.phone} />
              <Row label="Email" value={lead.email} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">Fictional sample customer.</p>
          </Card>

          <Card title="Contact history">
            <ol className="relative space-y-4 border-s border-slate-200 ps-4">
              {[...lead.history].reverse().map((e, i) => (
                <li key={`${e.date}-${i}`} className="relative">
                  <span
                    aria-hidden
                    className={cx('absolute -start-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-white', e.direction === 'inbound' ? 'bg-sage-600' : 'bg-navy-700')}
                  />
                  <div className="text-xs text-slate-500">
                    {formatDate(e.date)} · {e.direction === 'inbound' ? 'Customer' : 'Your business'} · {e.channel}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-800">{e.summary}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FollowUpPanel({ lead, actionable, nextAction, apply }: { lead: Lead; actionable: boolean; nextAction: string; apply: Apply }) {
  const f = lead.followUp;
  const draft = currentDraft(lead);
  const edited = f.state === 'open' && f.draft !== null;

  if (f.state === 'open' && !actionable) {
    return (
      <Card title="Follow-up">
        <p className="text-sm text-slate-600">No follow-up is recommended for this lead, so no message has been drafted.</p>
      </Card>
    );
  }

  const step = f.state === 'completed' ? 3 : f.state === 'approved' ? 2 : 1;

  return (
    <Card
      title="Suggested follow-up"
      subtitle={f.state === 'open' ? `Next action: ${nextAction}` : undefined}
      action={f.state !== 'dismissed' ? <Stepper step={step} /> : undefined}
    >
      {f.state === 'dismissed' ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">This recommendation was dismissed. The lead will not be contacted.</p>
          <Button onClick={() => apply(lead.id, reopenFollowUp, 'Recommendation restored.')}>Restore recommendation</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Message to {lead.name.split(' ')[0]} (text or email){edited && ' · edited'}</span>
              {edited && (
                <button type="button" className="text-navy-700 hover:underline" onClick={() => apply(lead.id, (l) => editDraft(l, suggestedDraft(l), DEMO_AS_OF))}>
                  Restore suggestion
                </button>
              )}
            </span>
            <textarea
              value={draft}
              readOnly={f.state !== 'open'}
              onChange={(e) => apply(lead.id, (l) => editDraft(l, e.target.value, DEMO_AS_OF))}
              rows={7}
              className={cx(
                'mt-1.5 block w-full rounded-md border px-3 py-2.5 text-sm leading-relaxed text-slate-800 focus:outline-none',
                f.state === 'open' ? 'border-slate-300 bg-white focus:border-navy-700 focus:ring-1 focus:ring-navy-700' : 'border-slate-200 bg-slate-50',
              )}
            />
          </label>
          <p className="text-xs text-slate-500">
            This demonstration never sends messages. In the managed service, our team sends only messages you have approved.
          </p>

          {f.state === 'open' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" disabled={draft.trim() === ''} onClick={() => apply(lead.id, (l) => approveFollowUp(l, DEMO_AS_OF), 'Draft approved. Ready for the team to send.')}>
                Approve draft
              </Button>
              <Button variant="ghost" onClick={() => apply(lead.id, dismissFollowUp, 'Recommendation dismissed.')}>
                Dismiss recommendation
              </Button>
            </div>
          )}

          {f.state === 'approved' && (
            <div className="space-y-3 pt-1">
              <Notice tone="navy">Approved {formatDate(f.approvedOn)}. Waiting for the recovery team to send it.</Notice>
              <div className="flex flex-wrap gap-2">
                <Button variant="confirm" onClick={() => apply(lead.id, (l) => completeFollowUp(l, DEMO_AS_OF), 'Follow-up marked completed. Dashboard and reports updated.')}>
                  Mark follow-up completed
                </Button>
                <Button variant="secondary" onClick={() => apply(lead.id, reviseFollowUp)}>
                  Edit again
                </Button>
                <Button variant="ghost" onClick={() => apply(lead.id, dismissFollowUp, 'Recommendation dismissed.')}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {f.state === 'completed' && (
            <div className="space-y-3 pt-1">
              <Notice tone="green">
                Follow-up completed {formatDate(f.completedOn)}.{' '}
                {f.outcome === 'appointment' ? 'Appointment booked.' : f.outcome === 'replied' ? 'Customer replied.' : 'Waiting for a response.'}
              </Notice>
              {f.outcome !== 'appointment' && (
                <div>
                  <p className="mb-2 text-xs text-slate-500">Record an illustrative result for the demo:</p>
                  <div className="flex flex-wrap gap-2">
                    {f.outcome === 'none' && (
                      <Button onClick={() => apply(lead.id, (l) => recordOutcome(l, 'replied', DEMO_AS_OF), 'Reply recorded.')}>Customer replied</Button>
                    )}
                    <Button onClick={() => apply(lead.id, (l) => recordOutcome(l, 'appointment', DEMO_AS_OF), 'Appointment recorded.')}>Appointment booked</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ['Drafted', 'Approved', 'Completed'];
  return (
    <ol className="flex items-center gap-1.5 text-xs" aria-label="Follow-up progress">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < step || (n === 3 && step === 3);
        const current = n === step;
        return (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-slate-300" />}
            <span
              aria-current={current ? 'step' : undefined}
              className={cx(
                'rounded-full px-2 py-0.5 font-medium',
                done ? 'bg-sage-100 text-sage-700' : current ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-500',
              )}
            >
              {done && '✓ '}
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Notice({ tone, children }: { tone: 'navy' | 'green'; children: ReactNode }) {
  return (
    <p className={cx('rounded-md px-3 py-2 text-sm', tone === 'navy' ? 'bg-navy-50 text-navy-900' : 'bg-sage-50 text-sage-700 ring-1 ring-inset ring-sage-100')}>
      {children}
    </p>
  );
}

function Fact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cx('mt-0.5 font-medium', alert ? 'text-red-800' : 'text-navy-900')}>{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end text-slate-800">{value}</dd>
    </div>
  );
}
