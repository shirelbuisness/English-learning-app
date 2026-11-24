import { useMemo, useState, type ReactNode } from 'react';
import { formatDate, formatHours, formatUsd } from '../domain/dates.ts';
import { addExpense, addTimeEntry, deleteExpense, deleteTimeEntry, setPilotEconomics } from '../domain/economics.ts';
import { eventsCsv, logExport, recordsCsv, reportCsv, timeCsv } from '../domain/lifecycle.ts';
import { pilotReport } from '../domain/report.ts';
import { CHANNEL_LABELS, TIME_CATEGORIES, TIME_CATEGORY_LABELS, type Pilot, type TimeCategory } from '../domain/types.ts';
import { Button, Callout, Card, cx, Empty, Field, inputClass, Stat, td, th } from './shared.tsx';
import { download, now, type Workbench } from './useWorkbench.ts';

export function ReportPage({ wb, pilot }: { wb: Workbench; pilot: Pilot | null }) {
  const { state } = wb;
  const today = now().today;
  const report = useMemo(() => (pilot ? pilotReport(state, pilot.id, today) : null), [state, pilot, today]);
  if (!pilot || !report) return <Empty>Select or create a pilot.</Empty>;
  const { dataQuality: q, activity: a, outcomes: o, economics: e } = report;
  const contractor = state.contractors.find((c) => c.id === pilot.contractorId);
  const slug = pilot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const exp = (what: string, file: string, text: string) => {
    download(`${slug}-${file}-${today}.csv`, text);
    wb.run((s, c) => logExport(s, pilot.id, what, c), { quiet: true });
    wb.notify('success', `Exported ${what} (${file}).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Pilot report · {pilot.name}</h1>
          <p className="text-sm text-slate-500">{contractor?.businessName} · {formatDate(pilot.startDate)} – {formatDate(pilot.endDate)} · as of {formatDate(today)}. Every figure is computed from recorded records, contacts, handoffs and time entries.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exp('pilot report', 'report', reportCsv(report))}>Export report CSV</Button>
          <Button onClick={() => exp('record list', 'records', recordsCsv(state, pilot.id, today))}>Records CSV</Button>
          <Button onClick={() => exp('activity log', 'activity-log', eventsCsv(state, pilot.id))}>Activity log CSV</Button>
          <Button onClick={() => exp('time entries', 'time', timeCsv(state, pilot.id))}>Time CSV</Button>
        </div>
      </div>
      {pilot.isDemo && <Callout tone="amber"><strong>Synthetic demonstration pilot.</strong> These figures are illustrative and are not actual results.</Callout>}

      <Section title="Data quality and eligibility">
        <Stat label="Rows in imported files" value={q.rowsInFiles} />
        <Stat label="Records imported" value={q.imported} hint={`of ${pilot.recordLimit} agreed`} />
        <Stat label="Duplicate rows detected" value={q.duplicates} hint={`${q.duplicatesUpdated} updated · ${q.conflicts} conflicts`} />
        <Stat label="Invalid rows" value={q.invalidRows} />
        <Stat label="Awaiting review" value={q.awaitingReview} tone={q.awaitingReview ? 'alert' : undefined} />
        <Stat label="Eligible" value={q.eligible} />
        <Stat label="Excluded by contractor" value={q.excluded} />
        <Stat label="Suppressed / ineligible" value={`${q.suppressed} / ${q.ineligible}`} />
      </Section>

      <Section title="Activity" note="Approved drafts are authorizations, not contacts. Only operator-confirmed contacts count as outreach.">
        <Stat label="Drafts prepared" value={a.draftsPrepared} />
        <Stat label="Drafts approved by contractor" value={a.draftsApproved} hint={`${a.awaitingApproval} awaiting approval`} />
        <Stat label="Approved, not yet contacted" value={a.approvedNotContacted} />
        <Stat label="Blocked drafts" value={a.blocked} hint="By suppression, exclusion or withdrawn channel" />
        <Stat label="Outreach completed" value={a.outreachCompleted} hint={a.byChannel.filter((c) => c.attempts).map((c) => `${c.attempts} ${CHANNEL_LABELS[c.channel].toLowerCase()}`).join(' · ') || 'operator-confirmed'} />
        <Stat label="Homeowners contacted" value={a.recordsContacted} />
        <Stat label="Homeowners replied" value={a.repliesReceived} />
        <Stat label="Opt-outs" value={o.optOuts} />
      </Section>

      <Card title="Outcomes" subtitle="Each stage is a subset of the one above it. Contractor-reported stages are as reported, not verified by us unless stated.">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-slate-100">
              <Ladder label="Homeowners replied" value={a.repliesReceived} note="Any reply, including declines and opt-outs" />
              <Ladder label="Positive responses" value={o.positiveResponses} note="Interested, callback, inspection or revised estimate" />
              <Ladder label="Qualified re-engagements" value={o.qualified} note="Homeowner confirmed the project is unresolved and asked for a next step" />
              <Ladder label="Warm handoffs created" value={o.handoffs} />
              <Ladder label="Contractor acknowledgements" value={o.acknowledged} />
              <Ladder label="Appointments / inspections reported" value={o.appointmentsReported} note="Reported by the contractor" />
              <Ladder label="Jobs won (contractor-verified)" value={o.jobsWonVerified} note={o.jobsWonVerified ? `Reported job value ${formatUsd(o.reportedJobValue)}` : 'None reported'} />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Estimate values: {formatUsd(report.estimateValue.eligible)} currently eligible · {formatUsd(report.estimateValue.contacted)} contacted · {formatUsd(report.estimateValue.qualified)} in qualified re-engagements.
          These are estimate amounts — potential opportunity, not recovered revenue.
        </p>
      </Card>

      <Card title="Results by estimate age at import" subtitle="Tests the 14–60 day window hypothesis. Small samples: do not draw conclusions from one pilot.">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-slate-100"><tr>{['Age band', 'Records', 'Eligible', 'Contacted', 'Replied', 'Qualified'].map((h, i) => <th key={h} className={cx(th, i === 0 ? 'ps-4' : 'text-end', i === 5 && 'pe-4')}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {report.ageBands.map((b) => (
                <tr key={b.label}>
                  <td className={cx(td, 'ps-4')}>{b.label}</td>
                  <td className={cx(td, 'text-end')}>{b.records}</td><td className={cx(td, 'text-end')}>{b.eligible}</td><td className={cx(td, 'text-end')}>{b.contacted}</td><td className={cx(td, 'text-end')}>{b.replies}</td><td className={cx(td, 'pe-4 text-end')}>{b.qualified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Economics wb={wb} pilot={pilot} e={e} />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">{children}</div>
    </section>
  );
}

function Ladder({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <tr>
      <td className={cx(td, 'ps-4 font-medium text-navy-900')}>{label}</td>
      <td className={cx(td, 'text-end text-lg font-semibold tabular-nums text-navy-900')}>{value}</td>
      <td className={cx(td, 'pe-4 text-xs text-slate-500')}>{note}</td>
    </tr>
  );
}

function Economics({ wb, pilot, e }: { wb: Workbench; pilot: Pilot; e: ReturnType<typeof pilotReport>['economics'] }) {
  const { state } = wb;
  const today = now().today;
  const [rate, setRate] = useState(String(pilot.hourlyCost));
  const [rev, setRev] = useState(String(pilot.revenue));
  const [t, setT] = useState({ category: 'outreach' as TimeCategory, minutes: '', date: today, basis: 'measured' as 'measured' | 'estimated', notes: '' });
  const [x, setX] = useState({ description: '', amount: '', date: today });
  const entries = state.timeEntries.filter((te) => te.pilotId === pilot.id).slice().sort((p, q) => q.date.localeCompare(p.date));
  const expenses = state.expenses.filter((ex) => ex.pilotId === pilot.id);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Delivery economics" subtitle="Before taxes and other overhead. Hourly cost is an internal assumption; revenue is entered manually.">
        <dl className="space-y-1.5 text-sm">
          <Line k="Operator time — measured" v={formatHours(e.measuredMinutes)} />
          <Line k="Operator time — estimated (reconstructed)" v={formatHours(e.estimatedMinutes)} />
          <Line k="Total operator time" v={formatHours(e.totalMinutes)} strong />
          <Line k="Average per imported record" v={e.minutesPerImported === null ? '—' : `${e.minutesPerImported.toFixed(1)} min`} />
          <Line k={`Average per record that reached eligibility (${e.eligibleEver})`} v={e.minutesPerEligible === null ? '—' : `${e.minutesPerEligible.toFixed(1)} min`} />
          <Line k={`Labor cost (assumption: ${formatUsd(e.hourlyCost, true)}/h)`} v={formatUsd(e.laborCost, true)} />
          <Line k="Additional expenses" v={formatUsd(e.expenses, true)} />
          <Line k="Total estimated delivery cost" v={formatUsd(e.totalCost, true)} strong />
          <Line k="Pilot revenue (entered)" v={formatUsd(e.revenue, true)} />
          <Line k="Contribution before taxes and overhead" v={formatUsd(e.contribution, true)} strong tone={e.contribution < 0 ? 'red' : 'green'} />
        </dl>
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3" onSubmit={(ev) => { ev.preventDefault(); wb.run((s, c) => setPilotEconomics(s, pilot.id, Number(rate), Number(rev), c)); }}>
          <Field label="Hourly cost assumption (USD)"><input inputMode="decimal" className={cx(inputClass, 'w-32')} value={rate} onChange={(ev) => setRate(ev.target.value)} /></Field>
          <Field label="Pilot revenue (USD)"><input inputMode="decimal" className={cx(inputClass, 'w-32')} value={rev} onChange={(ev) => setRev(ev.target.value)} /></Field>
          <Button type="submit">Save</Button>
        </form>
        <div className="mt-4 -mx-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="border-b border-slate-100"><tr><th className={cx(th, 'ps-4')}>Category</th><th className={cx(th, 'text-end')}>Measured</th><th className={cx(th, 'pe-4 text-end')}>Estimated</th></tr></thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {e.byCategory.map((c) => (
                <tr key={c.category}><td className={cx(td, 'ps-4')}>{TIME_CATEGORY_LABELS[c.category]}</td><td className={cx(td, 'text-end')}>{c.measured ? formatHours(c.measured) : '—'}</td><td className={cx(td, 'pe-4 text-end')}>{c.estimated ? formatHours(c.estimated) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card title="Log operator time">
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={(ev) => {
            ev.preventDefault();
            const r = wb.run((s, c) => addTimeEntry(s, pilot.id, { ...t, minutes: Number(t.minutes) }, c));
            if (r.ok) setT({ ...t, minutes: '', notes: '' });
          }}>
            <Field label="Activity" className="sm:col-span-2">
              <select className={inputClass} value={t.category} onChange={(ev) => setT({ ...t, category: ev.target.value as TimeCategory })}>
                {TIME_CATEGORIES.map((c) => <option key={c} value={c}>{TIME_CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
            <Field label="Minutes"><input inputMode="numeric" className={inputClass} value={t.minutes} onChange={(ev) => setT({ ...t, minutes: ev.target.value })} /></Field>
            <Field label="Date"><input type="date" max={today} className={inputClass} value={t.date} onChange={(ev) => setT({ ...t, date: ev.target.value })} /></Field>
            <Field label="Basis">
              <select className={inputClass} value={t.basis} onChange={(ev) => setT({ ...t, basis: ev.target.value as 'measured' | 'estimated' })}>
                <option value="measured">Measured (timed)</option>
                <option value="estimated">Estimated afterwards</option>
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2"><input className={inputClass} value={t.notes} onChange={(ev) => setT({ ...t, notes: ev.target.value })} /></Field>
            <div className="self-end"><Button type="submit" variant="primary">Add</Button></div>
          </form>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {entries.map((te) => (
                  <tr key={te.id}>
                    <td className="py-1.5 pe-2 whitespace-nowrap text-slate-500">{formatDate(te.date)}</td>
                    <td className="py-1.5 pe-2">{TIME_CATEGORY_LABELS[te.category]}{te.notes && <span className="text-xs text-slate-500"> · {te.notes}</span>}</td>
                    <td className="py-1.5 pe-2 text-end tabular-nums">{te.minutes} min</td>
                    <td className="py-1.5 pe-2 text-xs text-slate-500">{te.basis}</td>
                    <td className="py-1.5 text-end"><Button size="sm" variant="ghost" onClick={() => wb.run((s, c) => deleteTimeEntry(s, te.id, c))}>Remove</Button></td>
                  </tr>
                ))}
                {entries.length === 0 && <tr><td className="py-3 text-slate-500">No time logged yet. Log time as you work — the first pilot should measure, not assume.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Additional expenses">
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={(ev) => {
            ev.preventDefault();
            const r = wb.run((s, c) => addExpense(s, pilot.id, { description: x.description, amount: Number(x.amount.replace(/[$,]/g, '')), date: x.date }, c));
            if (r.ok) setX({ ...x, description: '', amount: '' });
          }}>
            <Field label="Description" className="sm:col-span-2"><input className={inputClass} value={x.description} onChange={(ev) => setX({ ...x, description: ev.target.value })} /></Field>
            <Field label="Amount (USD)"><input inputMode="decimal" className={inputClass} value={x.amount} onChange={(ev) => setX({ ...x, amount: ev.target.value })} /></Field>
            <Field label="Date"><input type="date" max={today} className={inputClass} value={x.date} onChange={(ev) => setX({ ...x, date: ev.target.value })} /></Field>
            <div><Button type="submit" variant="primary">Add expense</Button></div>
          </form>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {expenses.map((ex) => (
              <li key={ex.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{ex.description} <span className="text-xs text-slate-500">{formatDate(ex.date)}</span></span>
                <span className="flex items-center gap-2 tabular-nums">{formatUsd(ex.amount, true)}<Button size="sm" variant="ghost" onClick={() => wb.run((s, c) => deleteExpense(s, ex.id, c))}>Remove</Button></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Line({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'red' | 'green' }) {
  return (
    <div className={cx('flex justify-between gap-3', strong && 'border-t border-slate-100 pt-1.5 font-semibold')}>
      <dt className="text-slate-600">{k}</dt>
      <dd className={cx('tabular-nums', tone === 'red' ? 'text-red-800' : tone === 'green' ? 'text-sage-700' : 'text-navy-900')}>{v}</dd>
    </div>
  );
}
