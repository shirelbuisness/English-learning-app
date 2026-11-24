import { formatDate, formatUsd } from '../logic/dates.ts';
import type { Metrics } from '../logic/metrics.ts';
import { PRIORITY_LABELS, SITUATION_LABELS, type Priority, type Situation } from '../logic/types.ts';
import { Card, PriorityBadge, cx, tdClass, thClass } from './shared.tsx';

export function Reporting({ metrics, onOpenLead }: { metrics: Metrics; onOpenLead: (id: string) => void }) {
  const m = metrics;
  const funnel = [
    { label: 'Leads needing follow-up', ...m.needsFollowUp, note: 'Drafted or approved, not yet sent' },
    { label: 'Approved follow-ups', ...m.approved, note: 'Approved by you, not yet sent' },
    { label: 'Completed follow-ups', ...m.completed, note: 'Sent by the recovery team' },
    { label: 'Replies received', ...m.replies, note: 'Customer responded after a follow-up' },
    { label: 'Appointments booked', ...m.appointments, note: 'Customer agreed to meet after a follow-up' },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy-900">Results report</h1>
        <p className="mt-1 text-sm text-slate-500">Week ending {formatDate('2026-11-20')} · Hill Country Roofing</p>
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">Illustrative sample.</strong> All customers, results and dollar amounts are fictional.
        Dollar figures are the estimated value of jobs still open — potential opportunity, <em>not</em> recovered revenue.
        Revenue is only recovered when a job is sold.
      </p>

      <section aria-labelledby="opp" className="grid gap-3 sm:grid-cols-3">
        <h2 id="opp" className="sr-only">Potential opportunity</h2>
        <Figure label="Potential value: open estimates & inquiries" value={formatUsd(m.openOpportunities.value)} sub={`${m.openOpportunities.count} open leads`} />
        <Figure label="Potential value: leads needing follow-up" value={formatUsd(m.needsFollowUp.value)} sub={`${m.needsFollowUp.count} leads, ${m.priority.high.count} high priority`} />
        <Figure label="Potential value: leads that replied after follow-up" value={formatUsd(m.replies.value)} sub={`${m.replies.count} ${m.replies.count === 1 ? 'reply' : 'replies'} · ${m.appointments.count} ${m.appointments.count === 1 ? 'appointment' : 'appointments'} (illustrative)`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Follow-up activity and results" subtitle="Counts of leads at each stage, from the current demo data">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={cx(thClass, 'ps-0')}>Stage</th>
                <th className={cx(thClass, 'w-1/4')}><span className="sr-only">Bar</span></th>
                <th className={cx(thClass, 'text-end')}>Leads</th>
                <th className={cx(thClass, 'pe-0 text-end')}>Potential value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {funnel.map((f, i) => (
                <tr key={f.label}>
                  <td className={cx(tdClass, 'ps-0')}>
                    <div className="font-medium text-navy-900">{f.label}</div>
                    <div className="text-xs text-slate-500">{f.note}</div>
                  </td>
                  <td className={cx(tdClass, 'align-middle')}>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className={cx('h-2 rounded-full', i >= 3 ? 'bg-sage-600' : 'bg-navy-700')} style={{ width: `${(f.count / max) * 100}%` }} />
                    </div>
                  </td>
                  <td className={cx(tdClass, 'text-end font-semibold tabular-nums text-navy-900')}>{f.count}</td>
                  <td className={cx(tdClass, 'pe-0 text-end tabular-nums text-slate-600')}>{formatUsd(f.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m.dismissed.count > 0 && <p className="mt-3 text-xs text-slate-500">{m.dismissed.count} recommendation(s) dismissed by the reviewer.</p>}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Pipeline by priority" subtitle="All reviewed leads">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {(['high', 'medium', 'low', 'none'] as Priority[]).map((p) => (
                  <tr key={p}>
                    <td className="py-2"><PriorityBadge priority={p} /></td>
                    <td className="py-2 text-end font-semibold tabular-nums text-navy-900">{m.priority[p].count}</td>
                    <td className="py-2 text-end tabular-nums text-slate-600">{formatUsd(m.priority[p].value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">"{PRIORITY_LABELS.none}" includes booked, closed, opted-out, recently contacted and already-handled leads.</p>
          </Card>

          <Card title="Open follow-ups by situation">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {(Object.keys(m.situations) as Situation[]).map((s) => (
                  <tr key={s}>
                    <td className="py-2 text-slate-700">{SITUATION_LABELS[s]}</td>
                    <td className="py-2 text-end font-semibold tabular-nums text-navy-900">{m.situations[s].count}</td>
                    <td className="py-2 text-end tabular-nums text-slate-600">{formatUsd(m.situations[s].value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      <Card title="Completed follow-ups" subtitle="Each follow-up the recovery team completed, with its illustrative result">
        {m.completedList.length === 0 ? (
          <p className="text-sm text-slate-500">No follow-ups completed yet.</p>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={cx(thClass, 'ps-5')}>Customer</th>
                  <th className={thClass}>Completed</th>
                  <th className={thClass}>Result</th>
                  <th className={cx(thClass, 'pe-5 text-end')}>Potential value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.completedList.map(({ lead }) => (
                  <tr key={lead.id} className="cursor-pointer hover:bg-navy-50/50" onClick={() => onOpenLead(lead.id)}>
                    <td className={cx(tdClass, 'ps-5')}>
                      <div className="font-medium text-navy-900">{lead.name}</div>
                      <div className="text-xs text-slate-500">{lead.service}</div>
                    </td>
                    <td className={cx(tdClass, 'whitespace-nowrap')}>{formatDate(lead.followUp.completedOn)}</td>
                    <td className={tdClass}>
                      {lead.followUp.outcome === 'appointment' ? 'Appointment booked' : lead.followUp.outcome === 'replied' ? 'Customer replied' : <span className="text-slate-500">Awaiting response</span>}
                    </td>
                    <td className={cx(tdClass, 'pe-5 text-end tabular-nums')}>{formatUsd(lead.estimateValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
