import type { ReactNode } from 'react';
import { formatDate, formatUsd } from '../domain/dates.ts';
import { contractorSummary, handoffList, pilotReport } from '../domain/report.ts';
import { CHANNEL_LABELS, HANDOFF_OUTCOME_LABELS, REQUEST_LABELS, type Pilot } from '../domain/types.ts';
import { href } from './App.tsx';
import { Button, cx, Empty } from './shared.tsx';
import { now, type Workbench } from './useWorkbench.ts';

/*
 * Contractor-facing pilot report, designed to be printed or saved as PDF.
 * It deliberately excludes internal economics (cost, hourly rate, margin)
 * and operator notes. Every number comes from pilotReport().
 */
export function ContractorReportPage({ wb, pilot }: { wb: Workbench; pilot: Pilot | null }) {
  if (!pilot) return <Empty>Select a pilot first.</Empty>;
  const { state } = wb;
  const today = now().today;
  const r = pilotReport(state, pilot.id, today);
  const handoffs = handoffList(state, pilot.id);
  const contractor = state.contractors.find((c) => c.id === pilot.contractorId);
  const q = r.dataQuality;
  const a = r.activity;
  const o = r.outcomes;
  const ro = r.reviewOutcome;
  const channels = a.byChannel.filter((c) => c.attempts > 0).map((c) => `${c.attempts} by ${CHANNEL_LABELS[c.channel].toLowerCase()}`);
  const hours = r.economics.totalMinutes / 60;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href={href({ page: 'report' })} className="text-sm text-slate-600 hover:text-navy-900">← Back to internal report</a>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Use “Save as PDF” in the print dialog to email it.</span>
          <Button variant="primary" onClick={() => window.print()}>Print / save as PDF</Button>
        </div>
      </div>

      <article className="rounded-lg border border-slate-200 bg-white p-5 sm:p-8 text-[15px] leading-relaxed text-slate-800 shadow-sm print:border-0 print:p-0 print:shadow-none">
        {pilot.isDemo && (
          <p className="mb-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Illustrative example built from fictional data. These are not actual results.
          </p>
        )}

        <header className="border-b-2 border-navy-900 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-sage-700">Estimate follow-up pilot report</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy-900">{contractor?.businessName}</h1>
          <p className="text-sm text-slate-600">
            {pilot.name} · {formatDate(pilot.startDate)} – {formatDate(pilot.endDate)} · report date {formatDate(today)}
          </p>
        </header>

        <section className="mt-6">
          <h2 className="text-base font-semibold text-navy-900">Summary</h2>
          <p className="mt-2">{contractorSummary(r)}</p>
        </section>

        <Section title="1. What we reviewed">
          <Rows
            rows={[
              ['Estimates received from you', q.rowsInFiles],
              ['Duplicates removed', q.duplicates],
              ['Rows that could not be used (missing or invalid data)', q.invalidRows],
              ['Estimates loaded for review', q.imported],
              ['→ Cleared for follow-up', ro.clearedForFollowUp],
              ['→ Excluded at your request', ro.excludedByContractor],
              ['→ Already on do-not-contact (earlier opt-out)', ro.doNotContact],
              ['→ Not contactable (missing permission or details) or already sold/lost', ro.notContactable],
            ]}
          />
          {ro.laterOptedOutOrRestricted > 0 && (
            <p className="mt-2 text-sm text-slate-500">
              {ro.laterOptedOutOrRestricted} of the estimates cleared for follow-up were later stopped: the homeowner opted out or you asked us to exclude them.
            </p>
          )}
        </Section>

        <Section title="2. What we did">
          <Rows
            rows={[
              ['Messages you approved', a.draftsApproved],
              ['Follow-ups actually made', `${a.outreachCompleted}${channels.length ? ` (${channels.join(', ')})` : ''}`],
              ['Homeowners contacted', a.recordsContacted],
              ['Opt-out requests received during the pilot (all honoured)', o.optOuts],
              ['Hours of follow-up work', hours.toFixed(1)],
            ]}
          />
          <p className="mt-2 text-sm text-slate-500">Nothing is sent without your approval. Anyone who asks not to be contacted is not contacted again.</p>
        </Section>

        <Section title="3. What happened">
          <Rows
            rows={[
              ['Homeowners who replied', a.repliesReceived],
              ['Positive replies (interested, callback, inspection, revised estimate)', o.positiveResponses],
              ['Confirmed the project is still open and asked for a next step', o.qualified],
              ['Passed to you as warm handoffs', o.handoffs],
              ['Handoffs you acknowledged', o.acknowledged],
              ['Appointments or inspections you reported', o.appointmentsReported],
              ['Jobs won that you confirmed', o.jobsWonVerified],
            ]}
          />
          {o.jobsWonVerified > 0 && <p className="mt-2 text-sm">Job value you reported for confirmed wins: <strong>{formatUsd(o.reportedJobValue)}</strong>.</p>}
          <p className="mt-2 text-sm text-slate-500">
            Results after a handoff are as reported by you. Estimate amounts are the value of open estimates, not revenue.
          </p>
        </Section>

        <Section title="4. Warm handoffs">
          {handoffs.length === 0 ? (
            <p className="text-sm text-slate-500">No handoffs yet.</p>
          ) : (
            <div className="relative overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[560px] text-sm print:min-w-0">
              <thead>
                <tr className="border-b border-slate-300 text-start text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pe-2 text-start font-medium">Homeowner</th>
                  <th className="py-1.5 pe-2 text-start font-medium">Asked for</th>
                  <th className="py-1.5 pe-2 text-end font-medium">Estimate</th>
                  <th className="py-1.5 pe-2 text-start font-medium">Replied</th>
                  <th className="py-1.5 text-start font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {handoffs.map((h) => (
                  <tr key={h.recordId} className="break-inside-avoid">
                    <td className="py-2 pe-2 align-top">
                      <div className="font-medium text-navy-900">{h.name}</div>
                      <div className="text-xs text-slate-500">{h.city} · {h.service}</div>
                    </td>
                    <td className="py-2 pe-2 align-top">{REQUEST_LABELS[h.handoff.request]}<div className="text-xs text-slate-500">{h.handoff.homeownerRequest}</div></td>
                    <td className="py-2 pe-2 text-end align-top tabular-nums">{formatUsd(h.estimateAmount)}</td>
                    <td className="py-2 pe-2 align-top whitespace-nowrap">{formatDate(h.handoff.respondedOn)}</td>
                    <td className="py-2 align-top">
                      {h.handoff.outcome ? HANDOFF_OUTCOME_LABELS[h.handoff.outcome] : h.handoff.acknowledgedOn ? `Acknowledged ${formatDate(h.handoff.acknowledgedOn)}` : h.handoff.notifiedOn ? 'Waiting for your acknowledgement' : 'Being passed to you'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Section>

        <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-500">
          Prepared {formatDate(today)}. Counts are from the pilot's recorded activity. Homeowner details in this report are shared only with {contractor?.businessName}.
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-base font-semibold text-navy-900">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-200">
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="py-1.5 pe-4 text-slate-700">{k}</td>
            <td className={cx('py-1.5 text-end font-semibold tabular-nums text-navy-900')}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
