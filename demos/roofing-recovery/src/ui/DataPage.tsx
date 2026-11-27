import { useState } from 'react';
import { withDemoData } from '../data/demoSeed.ts';
import { withSamplePipeline } from '../data/samplePipeline.ts';
import { formatDate, formatTimestamp } from '../domain/dates.ts';
import { clearPilot, clearPilotPreview, logExport, pilotExport } from '../domain/lifecycle.ts';
import { formatPhone } from '../domain/normalize.ts';
import { reverseLedgerEntry } from '../domain/records.ts';
import type { Pilot } from '../domain/types.ts';
import { Badge, Button, Callout, Card, cx, Field, inputClass, td, th } from './shared.tsx';
import { download, now, type Workbench } from './useWorkbench.ts';

export function DataPage({ wb, pilot, onSelectPilot }: { wb: Workbench; pilot: Pilot | null; onSelectPilot: (id: string) => void }) {
  const { state } = wb;
  const [exportId, setExportId] = useState(pilot?.id ?? '');
  const [clearId, setClearId] = useState('');
  const [typed, setTyped] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [ledgerFor, setLedgerFor] = useState(state.contractors[0]?.id ?? '');
  const [logPilot, setLogPilot] = useState('');
  const [lifting, setLifting] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState('');
  const clearTarget = state.pilots.find((p) => p.id === clearId);
  const preview = clearTarget ? clearPilotPreview(state, clearTarget.id) : null;
  const pilotLabel = (p: Pilot) => `${state.contractors.find((c) => c.id === p.contractorId)?.businessName ?? '?'} — ${p.name}`;
  const ledger = state.suppression.filter((s) => s.contractorId === ledgerFor);
  const log = state.events.filter((e) => !logPilot || e.pilotId === logPilot).slice(-300).reverse();

  const doExport = () => {
    const p = state.pilots.find((x) => x.id === exportId);
    if (!p) return wb.notify('error', 'Choose a pilot to export.');
    const c = now();
    const data = pilotExport(state, p.id, c);
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    download(`${slug}-export-${c.today}.json`, JSON.stringify(data, null, 2), 'application/json');
    wb.run((s, ck) => logExport(s, p.id, 'full pilot data (JSON)', ck), { quiet: true });
    wb.notify('success', `Export complete: ${data?.records.length ?? 0} records, ${data?.events.length ?? 0} history events, ${data?.timeEntries.length ?? 0} time entries written to ${slug}-export-${c.today}.json.`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy-900">Data</h1>
        <p className="text-sm text-slate-500">Export, clearing and demo reset are separate operations. None of them affects another.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="A. Export pilot data" subtitle="Readable JSON: contractor, pilot, records with contact history, imports, time, expenses, activity log, the contractor's suppression ledger and the report.">
          <div className="space-y-3">
            <Field label="Pilot">
              <select className={inputClass} value={exportId} onChange={(e) => setExportId(e.target.value)}>
                <option value="">Choose…</option>
                {state.pilots.map((p) => <option key={p.id} value={p.id}>{pilotLabel(p)}</option>)}
              </select>
            </Field>
            <Button variant="primary" disabled={!exportId} onClick={doExport}>Export pilot data</Button>
            <p className="text-xs text-slate-500">CSV exports of the report, records, activity log and time are on the Report page. Exports are logged. Exported files are not encrypted.</p>
          </div>
        </Card>

        <Card title="B. Clear pilot data" subtitle="Deletes one pilot's operational data. Other pilots and demo data are not affected." tone="alert">
          <div className="space-y-3 text-sm">
            <Field label="Pilot to clear">
              <select className={inputClass} value={clearId} onChange={(e) => { setClearId(e.target.value); setTyped(''); setUnderstood(false); }}>
                <option value="">Choose…</option>
                {state.pilots.map((p) => <option key={p.id} value={p.id}>{pilotLabel(p)}</option>)}
              </select>
            </Field>
            {clearTarget && preview && (
              <>
                <div className="rounded-md bg-red-50 p-3 text-red-900">
                  <div className="font-medium">Will be deleted:</div>
                  <ul className="mt-1 list-disc ps-5">
                    <li>the pilot "{clearTarget.name}" and its settings</li>
                    <li>{preview.records} records with {preview.touches} drafts/contacts and {preview.handoffs} handoffs</li>
                    <li>{preview.imports} import batches, {preview.timeEntries} time entries, {preview.expenses} expenses</li>
                    <li>{preview.events} history events (a summary deletion event is kept)</li>
                  </ul>
                  <div className="mt-2 font-medium">Kept: {preview.ledgerEntriesKept} suppression-ledger entries, so those contacts stay suppressed if re-imported.</div>
                </div>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-red-700" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I have exported anything needed. This cannot be undone.</label>
                <Field label={`Type the pilot name to confirm: ${clearTarget.name}`}><input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
                <Button
                  variant="danger"
                  disabled={!understood || typed.trim() !== clearTarget.name}
                  onClick={() => {
                    const r = wb.run((s, c) => clearPilot(s, clearTarget.id, typed, c));
                    if (r.ok) {
                      setClearId('');
                      setTyped('');
                      setUnderstood(false);
                      if (pilot?.id === clearTarget.id && r.state.pilots[0]) onSelectPilot(r.state.pilots[0].id);
                    }
                  }}
                >
                  Clear this pilot's data
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card title="C. Demo data" subtitle="Replaces all sample/demo contractors and pilots. Pilots you created under non-demo contractors are never touched.">
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">Demo data now: {state.contractors.filter((c) => c.isDemo).length} contractors, {state.pilots.filter((p) => p.isDemo).length} pilots, {state.records.filter((r) => state.pilots.find((p) => p.id === r.pilotId)?.isDemo).length} records.</p>
            <div className="flex flex-wrap gap-2">
              {([
                ['Sample pipeline (10)', withSamplePipeline, 'Sample roofing pipeline loaded.'],
                ['Extended demo (35)', withDemoData, 'Extended demo loaded.'],
              ] as const).map(([label, build, message]) => (
                <Button
                  key={label}
                  onClick={() => {
                    if (!window.confirm(`Load the ${label.toLowerCase()}? Current demo data is replaced; your real pilots are kept.`)) return;
                    const r = wb.run((s, c) => {
                      try {
                        return { ok: true as const, state: build(s, c.today), message };
                      } catch (e) {
                        return { ok: false as const, error: `Could not load demo data: ${(e as Error).message}` };
                      }
                    });
                    if (r.ok) onSelectPilot(r.state.pilots.find((p) => p.isDemo)?.id ?? '');
                  }}
                >
                  Load {label.toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Suppression ledger"
        subtitle="Contractor-scoped do-not-contact list, kept separately from pilot records so clearing a pilot cannot re-enable a contact. Lifting an entry needs a reason and does not un-suppress any record. Retention period must be set by a reviewed legal and privacy policy before real data is used."
        action={
          <select className={cx(inputClass, 'w-64')} value={ledgerFor} onChange={(e) => setLedgerFor(e.target.value)} aria-label="Contractor">
            {state.contractors.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        }
      >
        {ledger.length === 0 ? <p className="text-sm text-slate-500">No entries.</p> : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-100"><tr>{['Email', 'Phone', 'Reason', 'Channel', 'Recorded', 'Status'].map((h, i) => <th key={h} className={cx(th, i === 0 && 'ps-4')}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className={cx(td, 'ps-4')}>{e.email ?? '—'}</td>
                    <td className={td}>{formatPhone(e.phone)}</td>
                    <td className={td}>{e.reason}</td>
                    <td className={td}>{e.channel}</td>
                    <td className={cx(td, 'whitespace-nowrap')}>{formatDate(e.recordedOn)}</td>
                    <td className={td}>
                      {e.active ? (
                        lifting === e.id ? (
                          <form className="flex flex-wrap items-center gap-2" onSubmit={(ev) => { ev.preventDefault(); if (wb.run((st, c) => reverseLedgerEntry(st, e.id, liftReason, c)).ok) { setLifting(null); setLiftReason(''); } }}>
                            <input autoFocus aria-label="Reason for lifting" className={cx(inputClass, 'w-56')} placeholder="Reason (audited)" value={liftReason} onChange={(ev) => setLiftReason(ev.target.value)} />
                            <Button size="sm" type="submit" variant="danger">Lift entry</Button>
                            <Button size="sm" variant="ghost" onClick={() => setLifting(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <span className="flex items-center gap-2"><Badge tone="red">Active</Badge><Button size="sm" variant="ghost" onClick={() => { setLifting(e.id); setLiftReason(''); }}>Review…</Button></span>
                        )
                      ) : (
                        <span className="text-xs text-slate-500">Lifted {formatTimestamp(e.reversedAt)}: {e.reversalReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Activity log"
        subtitle="Append-only history of operational actions (latest 300 shown)."
        action={
          <select className={cx(inputClass, 'w-64')} value={logPilot} onChange={(e) => setLogPilot(e.target.value)} aria-label="Filter by pilot">
            <option value="">All pilots</option>
            {state.pilots.map((p) => <option key={p.id} value={p.id}>{pilotLabel(p)}</option>)}
          </select>
        }
      >
        <div className="-mx-4 max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 border-b border-slate-100 bg-white"><tr>{['When', 'Event', 'Record', 'Change', 'Detail'].map((h, i) => <th key={h} className={cx(th, i === 0 && 'ps-4')}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {log.map((e) => {
                const r = e.recordId ? state.records.find((x) => x.id === e.recordId) : null;
                return (
                  <tr key={e.id}>
                    <td className={cx(td, 'ps-4 whitespace-nowrap text-xs text-slate-500')}>{formatTimestamp(e.at)}</td>
                    <td className={cx(td, 'font-mono text-xs')}>{e.type}</td>
                    <td className={cx(td, 'text-xs')}>{r ? <a className="text-navy-700 underline" href={`#/record/${r.id}`}>{r.customerName}</a> : e.recordId ?? '—'}</td>
                    <td className={cx(td, 'text-xs whitespace-nowrap')}>{e.from || e.to ? `${e.from ?? '∅'} → ${e.to ?? '∅'}` : ''}</td>
                    <td className={cx(td, 'text-xs')}>{e.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Callout tone="amber">Browser storage is not encrypted and is readable by anyone with access to this browser profile. Synthetic data only.</Callout>
    </div>
  );
}
