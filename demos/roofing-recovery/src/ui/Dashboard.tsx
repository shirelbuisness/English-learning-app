import { formatUsd } from '../logic/dates.ts';
import type { Metrics } from '../logic/metrics.ts';
import { SITUATION_LABELS, type Priority, type Situation } from '../logic/types.ts';
import { Button, Card, FollowUpTag, PriorityBadge, Stat, cx, tdClass, thClass } from './shared.tsx';

const SITUATION_ORDER: Situation[] = ['unanswered_reply', 'unanswered_inquiry', 'estimate_no_response', 'stalled_conversation'];

export function Dashboard({
  metrics,
  onOpenLead,
  onOpenPipeline,
}: {
  metrics: Metrics;
  onOpenLead: (id: string) => void;
  onOpenPipeline: (priority?: Priority) => void;
}) {
  const m = metrics;
  const top = m.priorityQueue.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Headline: the commercial opportunity in one sentence. */}
      <section className="rounded-lg border border-navy-800 bg-navy-900 px-6 py-5 text-white">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-wider text-navy-100/70">This week's review · {m.leadsReviewed} leads</p>
            <p className="mt-2 text-2xl font-semibold leading-snug sm:text-[1.7rem]">
              {m.needsFollowUp.count} leads worth {formatUsd(m.needsFollowUp.value)} in potential jobs are waiting on a follow-up.
            </p>
            <p className="mt-2 text-sm text-navy-100/80">
              {m.priority.high.count} are high priority. Our team has drafted a message for each one — you approve, we follow up.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenPipeline('high')}
              className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-navy-50"
            >
              Review high-priority leads
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Leads reviewed" value={m.leadsReviewed} hint="All leads in your pipeline" />
        <Stat label="Need follow-up" value={m.needsFollowUp.count} hint={`${formatUsd(m.needsFollowUp.value)} potential`} />
        <Stat label="High priority" value={m.priority.high.count} hint={`${formatUsd(m.priority.high.value)} potential`} tone="alert" />
        <Stat label="Follow-ups completed" value={m.completed.count} hint={`${m.approved.count} approved, not yet sent`} />
        <Stat label="Replies received" value={m.replies.count} hint="After a follow-up" tone="good" />
        <Stat label="Appointments booked" value={m.appointments.count} hint="After a follow-up" tone="good" />
        <Stat label="Open estimates & inquiries" value={formatUsd(m.openOpportunities.value)} hint="Potential value, not revenue" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Priority opportunities"
          subtitle="Ranked by transparent rules: job value, time since last contact and contact history."
          action={
            <Button variant="ghost" onClick={() => onOpenPipeline()}>
              View all leads →
            </Button>
          }
        >
          {top.length === 0 ? (
            <p className="text-sm text-slate-500">Every open lead has been handled. Nothing needs follow-up right now.</p>
          ) : (
            <div className="-mx-5 -my-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <th className={cx(thClass, 'ps-5')}>Customer</th>
                    <th className={thClass}>Why it was flagged</th>
                    <th className={cx(thClass, 'text-end')}>Est. value</th>
                    <th className={cx(thClass, 'pe-5')}>Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {top.map(({ lead, assessment }) => (
                    <tr key={lead.id} onClick={() => onOpenLead(lead.id)} className="cursor-pointer hover:bg-navy-50/50">
                      <td className={cx(tdClass, 'ps-5')}>
                        <button type="button" className="text-start font-medium text-navy-900 hover:underline" onClick={() => onOpenLead(lead.id)}>
                          {lead.name}
                        </button>
                        <div className="text-xs text-slate-500">{lead.city} · {lead.service}</div>
                      </td>
                      <td className={cx(tdClass, 'text-slate-700')}>
                        {assessment.summary}
                        <div className="mt-1"><FollowUpTag followUp={lead.followUp} /></div>
                      </td>
                      <td className={cx(tdClass, 'text-end font-medium tabular-nums text-navy-900')}>{formatUsd(lead.estimateValue)}</td>
                      <td className={cx(tdClass, 'pe-5')}>
                        <PriorityBadge priority={assessment.priority} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Where leads are slipping" subtitle="Open leads needing follow-up, by situation">
            <ul className="space-y-3">
              {SITUATION_ORDER.map((s) => {
                const v = m.situations[s];
                return (
                  <li key={s} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-700">{SITUATION_LABELS[s]}</span>
                    <span className="whitespace-nowrap tabular-nums">
                      <span className="font-semibold text-navy-900">{v.count}</span>
                      <span className="ms-2 text-slate-500">{formatUsd(v.value)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Follow-up activity" subtitle="Handled by the recovery team">
            <ol className="space-y-2.5 text-sm">
              <ActivityRow label="Drafted, awaiting your approval" value={m.awaitingReview.count} />
              <ActivityRow label="Approved, ready to send" value={m.approved.count} />
              <ActivityRow label="Completed" value={m.completed.count} />
              <ActivityRow label="Replies received" value={m.replies.count} good />
              <ActivityRow label="Appointments booked" value={m.appointments.count} good />
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-slate-700">{label}</span>
      <span className={cx('min-w-8 rounded px-2 py-0.5 text-center text-sm font-semibold tabular-nums', good ? 'bg-sage-100 text-sage-700' : 'bg-slate-100 text-navy-900')}>{value}</span>
    </li>
  );
}
