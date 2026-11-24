import { useMemo, useState } from 'react';
import { formatShortDate, formatUsd } from '../domain/dates.ts';
import { PRIORITY_LABELS, type PriorityCategory } from '../domain/priority.ts';
import { buildQueue, QUEUE_GROUPS, type QueueFilter } from '../domain/queue.ts';
import { approveDrafts, submitForApproval, type BatchOutcome } from '../domain/records.ts';
import { href, type Route } from './App.tsx';
import { Button, Callout, cx, Empty, inputClass, PriorityBadge, td, th } from './shared.tsx';
import { now, type Workbench } from './useWorkbench.ts';

export function QueuePage({ wb, go }: { wb: Workbench; go: (r: Route) => void }) {
  const { state } = wb;
  const today = now().today;
  const [filter, setFilter] = useState<QueueFilter>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ verb: string; outcome: BatchOutcome } | null>(null);

  const all = useMemo(() => buildQueue(state, today, { contractorId: filter.contractorId, pilotId: filter.pilotId }), [state, today, filter.contractorId, filter.pilotId]);
  const items = useMemo(() => buildQueue(state, today, filter), [state, today, filter]);
  const recordOf = (id: string) => state.records.find((r) => r.id === id)!;
  const pilotName = (id: string) => state.pilots.find((p) => p.id === id)?.name ?? '';
  const multiPilot = new Set(items.map((i) => i.pilotId)).size > 1;

  const selectable = (kind: string) => kind === 'finish_draft' || kind === 'awaiting_approval';
  const sel = items.filter((i) => i.touchId && selected.has(i.touchId));
  const selDrafts = sel.filter((i) => i.kind === 'finish_draft');
  const selAwaiting = sel.filter((i) => i.kind === 'awaiting_approval');
  const toggle = (touchId: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(touchId)) n.delete(touchId);
    else n.add(touchId);
    return n;
  });

  const runBatch = (verb: 'submit' | 'approve') => {
    const ids = (verb === 'submit' ? selDrafts : selAwaiting).map((i) => i.touchId!);
    const r = wb.run((s, c) => (verb === 'submit' ? submitForApproval(s, ids, c) : approveDrafts(s, ids, c)));
    if (r.ok && r.batch) setBatch({ verb: verb === 'submit' ? 'submitted for approval' : 'approved', outcome: r.batch });
    setSelected(new Set());
  };

  const pilotsFor = state.pilots.filter((p) => !filter.contractorId || p.contractorId === filter.contractorId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Today's queue</h1>
          <p className="text-sm text-slate-500">One list, in working order. Work from the top; open a record to act on it.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {QUEUE_GROUPS.map((g) => {
          const n = all.filter((i) => i.group === g.id).length;
          const active = filter.group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setFilter({ ...filter, group: active ? undefined : g.id })}
              aria-pressed={active}
              className={cx('rounded-lg border px-3 py-2.5 text-start', active ? 'border-navy-700 bg-navy-50' : 'border-slate-200 bg-white hover:border-slate-300')}
            >
              <div className="text-xs text-slate-500">
                {g.id}. {g.label}
              </div>
              <div className={cx('text-xl font-semibold tabular-nums', n ? 'text-navy-900' : 'text-slate-400')}>{n}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-600">
          Contractor
          <select className={cx(inputClass, 'mt-1 w-48')} value={filter.contractorId ?? ''} onChange={(e) => setFilter({ ...filter, contractorId: e.target.value || undefined, pilotId: undefined })}>
            <option value="">All contractors</option>
            {state.contractors.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Pilot
          <select className={cx(inputClass, 'mt-1 w-56')} value={filter.pilotId ?? ''} onChange={(e) => setFilter({ ...filter, pilotId: e.target.value || undefined })}>
            <option value="">All pilots</option>
            {pilotsFor.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Priority
          <select className={cx(inputClass, 'mt-1 w-40')} value={filter.priority ?? ''} onChange={(e) => setFilter({ ...filter, priority: (e.target.value || undefined) as PriorityCategory | undefined })}>
            <option value="">Any priority</option>
            {(['review', 'high', 'medium', 'low', 'none'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Follow-up date
          <select className={cx(inputClass, 'mt-1 w-40')} value={filter.due ?? ''} onChange={(e) => setFilter({ ...filter, due: (e.target.value || undefined) as QueueFilter['due'] })}>
            <option value="">Any date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Due within 7 days</option>
          </select>
        </label>
        {Object.values(filter).some(Boolean) && <Button variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}
      </div>

      {batch && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm" role="status">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-navy-900">
              Batch result: {batch.outcome.done.length} {batch.verb}, {batch.outcome.blocked.length} blocked.
              {batch.verb === 'approved' && <span className="font-normal text-slate-600"> Approved means authorized to send — nothing has been sent.</span>}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setBatch(null)}>Close</Button>
          </div>
          {batch.outcome.blocked.length > 0 && (
            <ul className="mt-2 space-y-1">
              {batch.outcome.blocked.map((b) => (
                <li key={b.touchId} className="text-red-800">
                  <a className="font-medium underline" href={href({ page: 'record', id: b.recordId })}>{b.name}</a>: not {batch.verb} — {b.reasons.join('; ')}
                </li>
              ))}
            </ul>
          )}
          {batch.outcome.done.length > 0 && <p className="mt-2 text-sage-700">{batch.verb[0]!.toUpperCase() + batch.verb.slice(1)}: {batch.outcome.done.map((d) => d.name).join(', ')}</p>}
        </div>
      )}

      {sel.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-navy-700 bg-navy-50 px-3 py-2 text-sm">
          <span className="font-medium text-navy-900">{sel.length} selected</span>
          <Button size="sm" variant="secondary" disabled={!selDrafts.length} onClick={() => runBatch('submit')}>
            Mark {selDrafts.length} sent to contractor for approval
          </Button>
          <Button size="sm" variant="primary" disabled={!selAwaiting.length} onClick={() => runBatch('approve')}>
            Record contractor approval for {selAwaiting.length}
          </Button>
          <span className="text-xs text-slate-600">Each record is re-checked; restricted records are never approved.</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {items.length === 0 ? (
        <Empty>{all.length === 0 ? 'Nothing needs attention right now. Import estimates or review records to fill the queue.' : 'No tasks match these filters.'}</Empty>
      ) : (
        QUEUE_GROUPS.filter((g) => items.some((i) => i.group === g.id)).map((g) => {
          const rows = items.filter((i) => i.group === g.id);
          const groupSelectable = rows.filter((i) => selectable(i.kind) && i.touchId);
          return (
            <section key={g.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                <h2 className="text-sm font-semibold text-navy-900">
                  {g.id}. {g.label} <span className="font-normal text-slate-500">({rows.length})</span>
                </h2>
                {groupSelectable.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected((s) => new Set([...s, ...groupSelectable.map((i) => i.touchId!)]))}>
                    Select all {groupSelectable.length}
                  </Button>
                )}
              </header>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b border-slate-100">
                    <tr>
                      <th className={cx(th, 'w-8')}><span className="sr-only">Select</span></th>
                      <th className={th}>Homeowner</th>
                      <th className={th}>Next action</th>
                      <th className={cx(th, 'text-end')}>Estimate</th>
                      <th className={th}>Due</th>
                      <th className={th}>Priority</th>
                      <th className={th}><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((i) => {
                      const r = recordOf(i.recordId);
                      const overdue = i.dueOn && i.dueOn < today;
                      return (
                        <tr key={i.key} className="hover:bg-slate-50">
                          <td className={td}>
                            {selectable(i.kind) && i.touchId && (
                              <input type="checkbox" aria-label={`Select ${r.customerName}`} checked={selected.has(i.touchId)} onChange={() => toggle(i.touchId!)} className="size-4 accent-navy-800" />
                            )}
                          </td>
                          <td className={td}>
                            <a href={href({ page: 'record', id: r.id })} className="font-medium text-navy-900 hover:underline">{r.customerName}</a>
                            <div className="text-xs text-slate-500">{r.city}{multiPilot && ` · ${pilotName(r.pilotId)}`}</div>
                          </td>
                          <td className={td}>
                            <div className="font-medium text-slate-800">{i.label}</div>
                            <div className="max-w-md text-xs text-slate-500">{i.detail}</div>
                          </td>
                          <td className={cx(td, 'text-end tabular-nums')}>{formatUsd(r.estimateAmount)}</td>
                          <td className={cx(td, 'whitespace-nowrap tabular-nums', overdue ? 'text-red-800' : 'text-slate-600')}>
                            {i.dueOn ? (i.dueOn === today ? 'Today' : formatShortDate(i.dueOn)) : '—'}
                            {overdue && <span className="block text-[11px]">overdue</span>}
                          </td>
                          <td className={td}>{i.group <= 3 && <PriorityBadge p={i.priority} />}</td>
                          <td className={cx(td, 'text-end')}>
                            <Button size="sm" variant={i.group === 1 ? 'secondary' : 'primary'} onClick={() => go({ page: 'record', id: r.id })}>Open</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
      <Callout tone="navy">
        Queue order: records needing review → drafts and contractor approvals → approved follow-ups due → homeowner replies → warm handoffs. Within a group: priority, then due date.
      </Callout>
    </div>
  );
}
