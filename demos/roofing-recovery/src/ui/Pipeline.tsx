import { useMemo, useRef, useState } from 'react';
import { CSV_COLUMNS, CSV_EXAMPLE } from '../logic/csv.ts';
import { formatDate, formatUsd } from '../logic/dates.ts';
import { assessAll } from '../logic/metrics.ts';
import { compareByPriority } from '../logic/priority.ts';
import { DEMO_AS_OF } from '../logic/dates.ts';
import { LEAD_STATUSES, PRIORITY_LABELS, STATUS_LABELS, type Lead, type LeadStatus, type Priority } from '../logic/types.ts';
import { Button, FollowUpTag, PriorityBadge, StatusBadge, cx, tdClass, thClass } from './shared.tsx';

export interface PipelineFilters {
  search: string;
  status: LeadStatus | 'all';
  priority: Priority | 'all' | 'actionable';
}

export const DEFAULT_FILTERS: PipelineFilters = { search: '', status: 'all', priority: 'all' };

const selectClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-navy-700 focus:outline-none focus:ring-1 focus:ring-navy-700';

export function Pipeline({
  leads,
  filters,
  onFiltersChange,
  onOpenLead,
  onImportCsv,
}: {
  leads: Lead[];
  filters: PipelineFilters;
  onFiltersChange: (f: PipelineFilters) => void;
  onOpenLead: (id: string) => void;
  onImportCsv: (text: string) => string[] | null;
}) {
  const [showImport, setShowImport] = useState(false);

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return assessAll(leads, DEMO_AS_OF)
      .filter(({ lead, assessment }) => {
        if (filters.status !== 'all' && lead.status !== filters.status) return false;
        if (filters.priority === 'actionable' && !assessment.actionable) return false;
        if (filters.priority !== 'all' && filters.priority !== 'actionable' && assessment.priority !== filters.priority) return false;
        if (!q) return true;
        return [lead.name, lead.city, lead.service, lead.source, lead.id].some((v) => v.toLowerCase().includes(q));
      })
      .sort(compareByPriority);
  }, [leads, filters]);

  const filtered = filters.search !== '' || filters.status !== 'all' || filters.priority !== 'all';
  const total = rows.reduce((s, r) => s + r.lead.estimateValue, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Lead pipeline</h1>
          <p className="text-sm text-slate-500">Every lead we reviewed, with the recommended next step. Select a lead to see the reasoning and draft.</p>
        </div>
        <Button variant="secondary" onClick={() => setShowImport((v) => !v)}>
          {showImport ? 'Close import' : 'Import CSV'}
        </Button>
      </div>

      {showImport && <CsvImport onImport={onImportCsv} onDone={() => setShowImport(false)} />}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="min-w-56 flex-1">
          <span className="sr-only">Search leads</span>
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Search name, city, service or source"
            className={cx(selectClass, 'w-full')}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Status
          <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as PipelineFilters['status'] })} className={selectClass}>
            <option value="all">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Priority
          <select value={filters.priority} onChange={(e) => onFiltersChange({ ...filters, priority: e.target.value as PipelineFilters['priority'] })} className={selectClass}>
            <option value="all">All priorities</option>
            <option value="actionable">Needs follow-up</option>
            {(['high', 'medium', 'low', 'none'] as const).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </label>
        {filtered && (
          <Button variant="ghost" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-sm text-slate-500" aria-live="polite">
        Showing {rows.length} of {leads.length} leads · {formatUsd(total)} estimated value
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className={cx(thClass, 'ps-4')}>Customer</th>
              <th className={thClass}>Service requested</th>
              <th className={thClass}>Received · source</th>
              <th className={cx(thClass, 'text-end')}>Est. value</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Last contact</th>
              <th className={cx(thClass, 'text-center')}>Follow-<br />ups</th>
              <th className={thClass}>Priority</th>
              <th className={cx(thClass, 'pe-4')}>Recommended next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ lead, assessment }) => (
              <tr key={lead.id} onClick={() => onOpenLead(lead.id)} className={cx('cursor-pointer hover:bg-navy-50/50', !assessment.actionable && 'text-slate-500')}>
                <td className={cx(tdClass, 'ps-4')}>
                  <button type="button" onClick={() => onOpenLead(lead.id)} className="text-start font-medium text-navy-900 hover:underline">
                    {lead.name}
                  </button>
                  <div className="text-xs text-slate-500">{lead.city}</div>
                </td>
                <td className={cx(tdClass, 'min-w-40')}>{lead.service}</td>
                <td className={tdClass}>
                  <div className="whitespace-nowrap tabular-nums">{formatDate(lead.receivedDate)}</div>
                  <div className="text-xs text-slate-500">{lead.source}</div>
                </td>
                <td className={cx(tdClass, 'text-end font-medium tabular-nums text-navy-900')}>{formatUsd(lead.estimateValue)}</td>
                <td className={tdClass}><StatusBadge status={lead.status} /></td>
                <td className={cx(tdClass, 'whitespace-nowrap tabular-nums')}>{lead.lastContactDate ? formatDate(lead.lastContactDate) : <span className="text-red-800">Never</span>}</td>
                <td className={cx(tdClass, 'text-center tabular-nums')}>{lead.followUpCount}</td>
                <td className={tdClass}><PriorityBadge priority={assessment.priority} /></td>
                <td className={cx(tdClass, 'pe-4 min-w-48')}>
                  {assessment.actionable ? <span className="text-navy-900">{assessment.nextAction}</span> : <span>{assessment.summary}</span>}
                  <div className="mt-1"><FollowUpTag followUp={lead.followUp} /></div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">No leads match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CsvImport({ onImport, onDone }: { onImport: (text: string) => string[] | null; onDone: () => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    setErrors([]);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setErrors(['Please choose a .csv file.']);
    if (file.size > 500_000) return setErrors(['File is larger than 500 KB.']);
    const result = onImport(await file.text());
    if (result) setErrors(result);
    else onDone();
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium text-navy-900">Import leads from CSV</p>
      <p className="mt-1 text-slate-600">
        Use fictional sample data only. Required columns: <code className="text-xs">{CSV_COLUMNS.join(', ')}</code>. Dates as YYYY-MM-DD.
        The file is checked in your browser and nothing is uploaded. If any row is invalid, nothing is imported.
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{CSV_EXAMPLE}</pre>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e.target.files?.[0])} className="mt-3 block text-sm file:me-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-3 file:py-1.5 file:text-white" />
      {errors.length > 0 && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
          <p className="font-medium">The file was not imported:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}
          </ul>
          {errors.length > 10 && <p className="mt-1">…and {errors.length - 10} more.</p>}
        </div>
      )}
    </div>
  );
}
