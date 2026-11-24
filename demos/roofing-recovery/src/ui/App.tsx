import { useEffect, useState } from 'react';
import { CONTRACTOR } from '../logic/contractor.ts';
import { DEMO_AS_OF, formatDate } from '../logic/dates.ts';
import type { Priority } from '../logic/types.ts';
import { Dashboard } from './Dashboard.tsx';
import { LeadDetail } from './LeadDetail.tsx';
import { DEFAULT_FILTERS, Pipeline, type PipelineFilters } from './Pipeline.tsx';
import { Reporting } from './Reporting.tsx';
import { cx } from './shared.tsx';
import { useDemo } from './useDemo.ts';

type Section = 'dashboard' | 'pipeline' | 'reporting';
type Route = { section: Section; leadId: string | null };

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pipeline', label: 'Lead pipeline' },
  { id: 'reporting', label: 'Reporting' },
];

function parseHash(hash: string): Route {
  const [section, leadId] = hash.replace(/^#\/?/, '').split('/');
  const s = SECTIONS.some((x) => x.id === section) ? (section as Section) : 'dashboard';
  return { section: s, leadId: leadId ? decodeURIComponent(leadId) : null };
}

function toHash(r: Route): string {
  return `#/${r.section}${r.leadId ? `/${encodeURIComponent(r.leadId)}` : ''}`;
}

export function App() {
  const demo = useDemo();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (r: Route) => {
    window.location.hash = toHash(r);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!demo.notice) return;
    const t = window.setTimeout(demo.dismissNotice, 4500);
    return () => window.clearTimeout(t);
  }, [demo.notice, demo.dismissNotice]);

  const lead = route.leadId ? demo.leads.find((l) => l.id === route.leadId) : undefined;
  const openLead = (id: string) => go({ section: route.section, leadId: id });
  const openPipeline = (priority?: Priority) => {
    setFilters({ ...DEFAULT_FILTERS, priority: priority ?? 'all' });
    go({ section: 'pipeline', leadId: null });
  };

  function handleReset() {
    if (window.confirm('Reset the demo to the original sample data? All approvals, edits and imports will be cleared.')) {
      setFilters(DEFAULT_FILTERS);
      demo.reset();
      go({ section: 'dashboard', leadId: null });
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div aria-hidden className="grid size-9 place-items-center rounded-md bg-navy-900 text-white">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M6 10v9h12v-9" />
                <path d="m9.5 14.5 2 2 3.5-4" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-900">Lead Recovery Desk</div>
              <div className="text-xs text-slate-500">Managed follow-up for {CONTRACTOR.company}</div>
            </div>
          </div>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto">
            {SECTIONS.map((s) => {
              const active = route.section === s.id;
              return (
                <a
                  key={s.id}
                  href={toHash({ section: s.id, leadId: null })}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium',
                    active ? 'bg-navy-50 text-navy-900' : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900',
                  )}
                >
                  {s.label}
                  {s.id === 'pipeline' && demo.metrics.priority.high.count > 0 && (
                    <span className="ms-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-800">{demo.metrics.priority.high.count}</span>
                  )}
                </a>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-slate-100 bg-sage-50">
          <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-sage-700 sm:px-6">
            <strong className="font-semibold">How it works:</strong> our team reviews every lead and estimate, drafts the follow-up, and sends it once you approve.
            You don't manage another CRM. You just approve.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {route.leadId && lead ? (
          <LeadDetail
            key={lead.id}
            lead={lead}
            apply={demo.apply}
            backLabel={`Back to ${SECTIONS.find((s) => s.id === route.section)?.label.toLowerCase()}`}
            onBack={() => go({ section: route.section, leadId: null })}
          />
        ) : route.leadId ? (
          <p className="text-sm text-slate-600">
            Lead not found.{' '}
            <button type="button" className="text-navy-700 underline" onClick={() => go({ section: route.section, leadId: null })}>
              Go back
            </button>
          </p>
        ) : route.section === 'pipeline' ? (
          <Pipeline leads={demo.leads} filters={filters} onFiltersChange={setFilters} onOpenLead={openLead} onImportCsv={demo.importCsv} />
        ) : route.section === 'reporting' ? (
          <Reporting metrics={demo.metrics} onOpenLead={openLead} />
        ) : (
          <Dashboard metrics={demo.metrics} onOpenLead={openLead} onOpenPipeline={openPipeline} />
        )}
      </main>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-5 text-xs text-slate-500 sm:px-6">
        <p>
          Sales demonstration · fictional data as of {formatDate(DEMO_AS_OF)} · no messages are sent · changes are saved in this browser only.
        </p>
        <button type="button" onClick={handleReset} className="rounded-md px-2 py-1 font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-white hover:text-navy-900">
          Reset demo data
        </button>
      </footer>

      {demo.notice && (
        <div
          key={demo.notice.id}
          role={demo.notice.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'fixed bottom-4 end-4 start-4 z-10 mx-auto max-w-md rounded-md px-4 py-3 text-sm shadow-lg sm:start-auto',
            demo.notice.kind === 'error' ? 'bg-red-800 text-white' : 'bg-navy-900 text-white',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span>{demo.notice.text}</span>
            <button type="button" aria-label="Dismiss" onClick={demo.dismissNotice} className="text-white/70 hover:text-white">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
