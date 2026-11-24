import { useMemo, useState } from 'react';
import { formatShortDate, formatUsd } from '../domain/dates.ts';
import { dataIssues } from '../domain/eligibility.ts';
import { prioritize, PRIORITY_LABELS, PRIORITY_ORDER, type PriorityCategory } from '../domain/priority.ts';
import { workflowStatus, WORKFLOW_LABELS, type WorkflowStatus } from '../domain/queue.ts';
import { ELIGIBILITY_SHORT, ESTIMATE_STATUS_LABELS, type EligibilityStatus, type Pilot } from '../domain/types.ts';
import { href, type Route } from './App.tsx';
import { Button, cx, Empty, EligibilityBadge, inputClass, PriorityBadge, td, th, WorkflowBadge } from './shared.tsx';
import { now, type Workbench } from './useWorkbench.ts';

export function RecordsPage({ wb, pilot, go }: { wb: Workbench; pilot: Pilot | null; go: (r: Route) => void }) {
  const { state } = wb;
  const today = now().today;
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState<PriorityCategory | ''>('');
  const [elig, setElig] = useState<EligibilityStatus | ''>('');
  const [wf, setWf] = useState<WorkflowStatus | ''>('');

  const rows = useMemo(() => {
    if (!pilot) return [];
    return state.records
      .filter((r) => r.pilotId === pilot.id)
      .map((r) => ({ r, p: prioritize(state, r, today), w: workflowStatus(state, r), issues: dataIssues(r, today) }))
      .sort((a, b) => PRIORITY_ORDER[a.p.category] - PRIORITY_ORDER[b.p.category] || b.r.estimateAmount - a.r.estimateAmount);
  }, [state, pilot, today]);

  if (!pilot) return <Empty>Create a contractor and pilot first (Contractors &amp; pilots).</Empty>;

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(({ r, p, w }) => {
    if (prio && p.category !== prio) return false;
    if (elig && r.eligibility.status !== elig) return false;
    if (wf && w !== wf) return false;
    return !needle || [r.customerName, r.email ?? '', r.phone ?? '', r.city, r.service, r.id].some((v) => v.toLowerCase().includes(needle));
  });
  const count = (s: EligibilityStatus) => rows.filter((x) => x.r.eligibility.status === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Records · {pilot.name}</h1>
          <p className="text-sm text-slate-500">
            {rows.length} of {pilot.recordLimit} agreed records · {count('pending_review')} pending review · {count('eligible')} eligible · {count('suppressed')} suppressed · {count('excluded')} excluded · {count('ineligible')} ineligible
          </p>
        </div>
        <Button variant="secondary" onClick={() => go({ page: 'import' })}>Import CSV</Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="min-w-56 flex-1 text-xs text-slate-600">
          Search
          <input type="search" className={cx(inputClass, 'mt-1')} placeholder="Name, email, phone, city, service" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="text-xs text-slate-600">
          Priority
          <select className={cx(inputClass, 'mt-1 w-40')} value={prio} onChange={(e) => setPrio(e.target.value as PriorityCategory | '')}>
            <option value="">Any</option>
            {(['review', 'high', 'medium', 'low', 'none'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Eligibility
          <select className={cx(inputClass, 'mt-1 w-40')} value={elig} onChange={(e) => setElig(e.target.value as EligibilityStatus | '')}>
            <option value="">Any</option>
            {(Object.keys(ELIGIBILITY_SHORT) as EligibilityStatus[]).map((s) => <option key={s} value={s}>{ELIGIBILITY_SHORT[s]}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Workflow status
          <select className={cx(inputClass, 'mt-1 w-48')} value={wf} onChange={(e) => setWf(e.target.value as WorkflowStatus | '')}>
            <option value="">Any</option>
            {(Object.keys(WORKFLOW_LABELS) as WorkflowStatus[]).map((s) => <option key={s} value={s}>{WORKFLOW_LABELS[s]}</option>)}
          </select>
        </label>
        {(q || prio || elig || wf) && <Button variant="ghost" onClick={() => { setQ(''); setPrio(''); setElig(''); setWf(''); }}>Clear</Button>}
      </div>

      {rows.length === 0 ? (
        <Empty>No records in this pilot yet. Import a CSV to start.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={th}>Homeowner</th>
                <th className={cx(th, 'text-end')}>Estimate</th>
                <th className={th}>Age</th>
                <th className={th}>Estimate status</th>
                <th className={th}>Eligibility</th>
                <th className={th}>Priority</th>
                <th className={th}>Workflow</th>
                <th className={th}>Data issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map(({ r, p, w, issues }) => {
                const errors = issues.filter((i) => i.level === 'error');
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => go({ page: 'record', id: r.id })}>
                    <td className={td}>
                      <a href={href({ page: 'record', id: r.id })} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-900 hover:underline">{r.customerName}</a>
                      <div className="text-xs text-slate-500">{r.city}{r.state ? `, ${r.state}` : ''} · {r.service || '—'}</div>
                    </td>
                    <td className={cx(td, 'text-end tabular-nums')}>
                      {formatUsd(r.estimateAmount)}
                      <div className="text-xs text-slate-500">{formatShortDate(r.estimateDate)}</div>
                    </td>
                    <td className={cx(td, 'tabular-nums whitespace-nowrap')}>{p.ageDays} d</td>
                    <td className={cx(td, 'whitespace-nowrap')}>{ESTIMATE_STATUS_LABELS[r.estimateStatus]}</td>
                    <td className={td}><EligibilityBadge s={r.eligibility.status} /></td>
                    <td className={td} title={p.summary}><PriorityBadge p={p.category} /></td>
                    <td className={td}><WorkflowBadge s={w} /></td>
                    <td className={cx(td, 'text-xs')}>
                      {errors.length ? <span className="text-red-800">{errors.map((e) => e.message).join('; ')}</span> : issues.length ? <span className="text-slate-500">{issues.length} warning(s)</span> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No records match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
