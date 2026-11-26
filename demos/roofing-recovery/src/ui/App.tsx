import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_PILOT, withSamplePipeline } from '../data/samplePipeline.ts';
import { stripDemo } from '../domain/lifecycle.ts';
import { buildQueue } from '../domain/queue.ts';
import { PILOT_STATUS_LABELS } from '../domain/types.ts';
import { DataPage } from './DataPage.tsx';
import { ContractorReportPage } from './ContractorReportPage.tsx';
import { ImportPage } from './ImportPage.tsx';
import { QueuePage } from './QueuePage.tsx';
import { RecordPage } from './RecordPage.tsx';
import { RecordsPage } from './RecordsPage.tsx';
import { ReportPage } from './ReportPage.tsx';
import { SetupPage } from './SetupPage.tsx';
import { cx } from './shared.tsx';
import { now, useWorkbench } from './useWorkbench.ts';

export type Route = { page: 'queue' | 'records' | 'record' | 'import' | 'report' | 'print' | 'setup' | 'data'; id?: string };
const PAGES: { page: Route['page']; label: string }[] = [
  { page: 'queue', label: 'Queue' },
  { page: 'records', label: 'Records' },
  { page: 'import', label: 'Import' },
  { page: 'report', label: 'Report' },
  { page: 'setup', label: 'Contractors & pilots' },
  { page: 'data', label: 'Data' },
];

function parse(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, '').split('/');
  if (page === 'record' && id) return { page: 'record', id: decodeURIComponent(id) };
  if (page === 'print') return { page: 'print' };
  return PAGES.some((p) => p.page === page) ? { page: page as Route['page'] } : { page: 'queue' };
}
export const href = (r: Route) => `#/${r.page}${r.id ? `/${encodeURIComponent(r.id)}` : ''}`;

const PILOT_KEY = 'roofing-recovery-workbench:selected-pilot';
const readPilot = () => {
  try {
    return localStorage.getItem(PILOT_KEY);
  } catch {
    return null;
  }
};

export function App() {
  const wb = useWorkbench();
  const { state } = wb;
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const [pilotId, setPilotId] = useState<string | null>(readPilot);

  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Keep the selected pilot valid (e.g. after clearing a pilot or resetting the demo).
  const pilot = state.pilots.find((p) => p.id === pilotId) ?? state.pilots.find((p) => p.status === 'active') ?? state.pilots[0] ?? null;
  useEffect(() => {
    try {
      if (pilot) localStorage.setItem(PILOT_KEY, pilot.id);
    } catch {
      // convenience only
    }
  }, [pilot]);

  useEffect(() => {
    if (!wb.notice || wb.notice.kind === 'warning') return;
    const t = window.setTimeout(wb.dismissNotice, wb.notice.kind === 'error' ? 9000 : 5000);
    return () => window.clearTimeout(t);
  }, [wb.notice, wb.dismissNotice]);

  const go = (r: Route) => {
    window.location.hash = href(r);
    window.scrollTo({ top: 0 });
  };
  const today = now().today;
  const hasDemo = state.contractors.some((c) => c.isDemo);

  const loadSample = () => {
    if (hasDemo && !window.confirm('Replace the current demo data with a fresh sample roofing pipeline? Your real pilots are not touched.')) return;
    const r = wb.run((s, c) => {
      try {
        return { ok: true as const, state: withSamplePipeline(s, c.today), message: 'Sample roofing pipeline loaded (fictional data).' };
      } catch (e) {
        return { ok: false as const, error: `Could not build the sample: ${(e as Error).message}` };
      }
    });
    if (r.ok) {
      setPilotId(r.state.pilots.find((p) => p.name === SAMPLE_PILOT)?.id ?? null);
      go({ page: 'queue' });
    }
  };

  const startReal = () => {
    if (!window.confirm('Remove all sample/demo data and start a real pilot? Real pilots you already created are kept.')) return;
    const r = wb.run((s) => ({ ok: true as const, state: stripDemo(s), message: 'Demo data removed. Create the contractor and pilot to begin.' }));
    if (r.ok) {
      setPilotId(r.state.pilots[0]?.id ?? null);
      go({ page: 'setup' });
    }
  };

  const queueCount = useMemo(() => buildQueue(state, today).length, [state, today]);
  const record = route.page === 'record' ? state.records.find((r) => r.id === route.id) : undefined;
  const contractorName = (id: string) => state.contractors.find((c) => c.id === id)?.businessName ?? '?';

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div aria-hidden className="grid size-8 place-items-center rounded bg-navy-900 text-white">
              <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M6 10v9h12v-9" />
                <path d="m9.5 14.5 2 2 3.5-4" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-navy-900">Lead Recovery Workbench</div>
              <div className="text-[11px] text-slate-500">Internal operator tool · prototype</div>
            </div>
          </div>
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto md:order-none md:w-auto">
            {PAGES.map((p) => {
              const active = route.page === p.page || (route.page === 'record' && p.page === 'records') || (route.page === 'print' && p.page === 'report');
              return (
                <a key={p.page} href={href({ page: p.page })} aria-current={active ? 'page' : undefined} className={cx('rounded px-2.5 py-1.5 text-sm font-medium whitespace-nowrap', active ? 'bg-navy-50 text-navy-900' : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900')}>
                  {p.label}
                  {p.page === 'queue' && queueCount > 0 && <span className="ms-1.5 rounded-full bg-navy-800 px-1.5 py-0.5 text-[11px] text-white tabular-nums">{queueCount}</span>}
                </a>
              );
            })}
          </nav>
          <div className="ms-auto flex items-center gap-1.5">
            <button type="button" onClick={loadSample} className="rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-sage-700 ring-1 ring-sage-600/40 ring-inset hover:bg-sage-50">
              Load sample pipeline
            </button>
            {hasDemo && (
              <button type="button" onClick={startReal} className="rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-navy-800 ring-1 ring-slate-300 ring-inset hover:bg-slate-50">
                Clear / start real pilot
              </button>
            )}
          </div>
          <label className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <span className="whitespace-nowrap">Working pilot</span>
            <select
              value={pilot?.id ?? ''}
              onChange={(e) => setPilotId(e.target.value)}
              className="max-w-72 min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-navy-900"
            >
              {state.contractors.map((c) => (
                <optgroup key={c.id} label={c.businessName}>
                  {state.pilots
                    .filter((p) => p.contractorId === c.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {PILOT_STATUS_LABELS[p.status]}
                      </option>
                    ))}
                </optgroup>
              ))}
              {state.pilots.length === 0 && <option value="">No pilots yet</option>}
            </select>
          </label>
        </div>
        {pilot?.isDemo ? (
          <div className="border-t border-amber-200 bg-amber-50">
            <p className="mx-auto max-w-[1400px] px-4 py-1.5 text-xs text-amber-900">
              <strong>Sample data:</strong> every homeowner and contractor here is fictional. Nothing is ever sent from this tool: messages go out from the contractor’s own inbox or phone, and you record them here.
            </p>
          </div>
        ) : pilot?.contactMode === 'in_workbench' ? (
          <div className="border-t border-red-200 bg-red-50">
            <p className="mx-auto max-w-[1400px] px-4 py-1.5 text-xs text-red-900">
              <strong>This pilot stores homeowner contact details in this browser (unencrypted).</strong> Not approved for real data until the security and legal steps in the README are done. Prefer a privacy-safe pilot.
            </p>
          </div>
        ) : (
          <div className="border-t border-sage-100 bg-sage-50">
            <p className="mx-auto max-w-[1400px] px-4 py-1.5 text-xs text-sage-700">
              <strong>Privacy-safe pilot:</strong> keep only estimate IDs, first names, scope, amounts and notes here. Phone numbers, emails and addresses stay in the contractor’s system. Browser storage is not encrypted. Nothing is sent from this tool.
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 print:p-0">
        {route.page === 'queue' && <QueuePage wb={wb} go={go} pilot={pilot} />}
        {route.page === 'records' && <RecordsPage wb={wb} pilot={pilot} go={go} />}
        {route.page === 'record' &&
          (record ? (
            <RecordPage key={record.id} wb={wb} record={record} go={go} />
          ) : (
            <p className="text-sm text-slate-600">
              Record not found (it may have been cleared). <a className="text-navy-700 underline" href={href({ page: 'records' })}>Back to records</a>
            </p>
          ))}
        {route.page === 'import' && <ImportPage wb={wb} pilot={pilot} go={go} />}
        {route.page === 'report' && <ReportPage wb={wb} pilot={pilot} />}
        {route.page === 'print' && <ContractorReportPage wb={wb} pilot={pilot} />}
        {route.page === 'setup' && <SetupPage wb={wb} pilot={pilot} onSelectPilot={setPilotId} />}
        {route.page === 'data' && <DataPage wb={wb} pilot={pilot} onSelectPilot={setPilotId} />}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-6 text-xs text-slate-500 print:hidden">
        {pilot ? `${contractorName(pilot.contractorId)} · ${pilot.name}` : 'No pilot selected'} · data stored in this browser only (unencrypted)
      </footer>

      {wb.notice && (
        <div
          key={wb.notice.id}
          role={wb.notice.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'fixed bottom-4 end-4 start-4 z-20 print:hidden mx-auto max-w-lg rounded-md px-4 py-3 text-sm shadow-lg sm:start-auto',
            wb.notice.kind === 'error' ? 'bg-red-800 text-white' : wb.notice.kind === 'warning' ? 'bg-amber-100 text-amber-950 ring-1 ring-amber-300' : 'bg-navy-900 text-white',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span>{wb.notice.text}</span>
            <button type="button" aria-label="Dismiss" onClick={wb.dismissNotice} className="opacity-70 hover:opacity-100">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
