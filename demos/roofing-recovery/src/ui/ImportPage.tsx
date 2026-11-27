import { useMemo, useState } from 'react';
import { formatUsd } from '../domain/dates.ts';
import { analyzeImport, COLUMN_HELP, commitImport, sampleEstimatesCsv, SAMPLE_CSV_COLUMNS, TEMPLATE_COLUMNS, templateCsv, type ImportAction, type RowAnalysis } from '../domain/importer.ts';
import { formatPhone } from '../domain/normalize.ts';
import { ELIGIBILITY_SHORT, type Pilot } from '../domain/types.ts';
import { href, type Route } from './App.tsx';
import { Badge, Button, Callout, Card, cx, Empty, inputClass, td, th } from './shared.tsx';
import { download, now, type Workbench } from './useWorkbench.ts';

const MATCH_LABEL: Record<RowAnalysis['match']['kind'], string> = {
  new: 'New',
  duplicate: 'Duplicate',
  conflict: 'Conflict — manual review',
  in_file_duplicate: 'Duplicate in file',
};

export function ImportPage({ wb, pilot, go }: { wb: Workbench; pilot: Pilot | null; go: (r: Route) => void }) {
  const { state } = wb;
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [decisions, setDecisions] = useState<Record<number, ImportAction>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const today = now().today;
  const analysis = useMemo(() => (pilot && text ? analyzeImport(state, pilot.id, text, today) : null), [state, pilot, text, today]);

  if (!pilot) return <Empty>Create a pilot before importing.</Empty>;

  async function onFile(f: File | undefined) {
    setFileError(null);
    setDecisions({});
    if (!f) return;
    if (f.size > 1_000_000) return setFileError('File is larger than 1 MB.');
    if (!/\.(csv|txt)$/i.test(f.name)) return setFileError('Choose a .csv file.');
    try {
      setText(await f.text());
      setFileName(f.name);
    } catch {
      setFileError('The file could not be read.');
    }
  }

  const rows = analysis?.rows ?? [];
  // Only mention missing columns that matter for this kind of pilot, in plain words.
  const HELPFUL: Record<string, string> = pilot.contactMode === 'contractor_system'
    ? { estimate_ref: 'estimate ID', notes: 'notes', service_requested: 'roof scope' }
    : { estimate_ref: 'estimate ID', notes: 'notes', service_requested: 'roof scope', customer_email: 'email', customer_phone: 'phone', email_consent: 'email consent', authorization_evidence: 'consent evidence' };
  const missingHelpful = (analysis?.missingOptionalColumns ?? []).filter((c) => c in HELPFUL).map((c) => HELPFUL[c]!);
  const action = (r: RowAnalysis) => decisions[r.rowNumber] ?? r.defaultAction;
  const toImport = rows.filter((r) => action(r) === 'import').length;
  const toUpdate = rows.filter((r) => action(r) === 'update').length;
  const overLimit = analysis ? analysis.existingCount + toImport > analysis.recordLimit : false;
  const counts = {
    newRows: rows.filter((r) => r.match.kind === 'new' && r.parsed).length,
    dup: rows.filter((r) => r.match.kind === 'duplicate').length,
    conflict: rows.filter((r) => r.match.kind === 'conflict').length,
    inFile: rows.filter((r) => r.match.kind === 'in_file_duplicate').length,
    invalid: rows.filter((r) => !r.parsed).length,
    warnings: rows.filter((r) => r.parsed && r.warnings.length).length,
  };

  const commit = () => {
    const r = wb.run((s, c) => commitImport(s, pilot.id, text, fileName, decisions, c));
    if (r.ok) {
      setText('');
      setFileName('');
      setDecisions({});
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy-900">Import estimates · {pilot.name}</h1>
        <p className="text-sm text-slate-500">
          Preview, check and choose per row before anything is saved. Duplicates are matched on the estimate ID, email or phone, within this pilot only. {state.records.filter((r) => r.pilotId === pilot.id).length} of {pilot.recordLimit} agreed records used.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1. Choose a file" className="lg:col-span-2">
          <div className="space-y-3 text-sm">
            <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="block text-sm file:me-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-3 file:py-1.5 file:text-white" />
            <details>
              <summary className="cursor-pointer text-slate-600">…or paste CSV text</summary>
              <textarea rows={5} className={cx(inputClass, 'mt-2 font-mono text-xs')} value={text} onChange={(e) => { setText(e.target.value); setFileName('pasted.csv'); setDecisions({}); }} placeholder={TEMPLATE_COLUMNS.join(',')} />
            </details>
            {fileError && <Callout tone="red">{fileError}</Callout>}
            {pilot.isDemo ? (
              <Callout tone="amber">Sample pilot: use fictional data here.</Callout>
            ) : pilot.contactMode === 'contractor_system' ? (
              <Callout tone="green">
                Privacy-safe pilot: only estimate IDs, first names, roof scope, amounts, dates and notes are kept. Phone numbers, emails, surnames and addresses are dropped automatically.
              </Callout>
            ) : (
              <Callout tone="red">This pilot keeps homeowner contact details in this browser (unencrypted). Not approved for real homeowner data; use a privacy-safe pilot instead.</Callout>
            )}
          </div>
        </Card>
        <Card title="CSV format" action={<Button size="sm" variant="primary" onClick={() => download('sample-estimates.csv', sampleEstimatesCsv())}>Download sample-estimates.csv</Button>}>
          <p className="text-sm text-slate-700">
            Minimum per estimate: <strong>{SAMPLE_CSV_COLUMNS.join(', ')}</strong>. No phone numbers, emails or addresses needed{pilot.contactMode === 'contractor_system' ? '; keep those in the contractor’s system' : ''}.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Messy exports are fine: headers like “Quote #”, “Job ID”, “Customer”, “Total”, “Date Sent” or “Comments” are recognised, amounts like “$18,400.00” and US dates like 11/03/2026 are accepted. Unrecognised columns are ignored.
          </p>
          <Button size="sm" variant="ghost" onClick={() => download('estimate-import-full-template.csv', templateCsv())}>Full template (all optional columns)</Button>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">Column reference ({TEMPLATE_COLUMNS.length} columns)</summary>
            <dl className="mt-2 space-y-1">
              {TEMPLATE_COLUMNS.map((c) => <div key={c}><dt className="font-mono text-navy-900">{c}</dt><dd>{COLUMN_HELP[c]}</dd></div>)}
            </dl>
          </details>
          <p className="mt-2 text-xs text-slate-500">
            {pilot.contactMode === 'contractor_system'
              ? 'Permission comes from the contractor’s confirmation on the pilot. New records start in review so you can check each one.'
              : 'Missing or unclear consent is imported as "unknown", which never counts as permission. New records start in review.'}
          </p>
        </Card>
      </div>

      {analysis && analysis.fatal.length > 0 && <Callout tone="red"><strong>This file cannot be imported:</strong> {analysis.fatal.join(' ')}</Callout>}

      {analysis && analysis.fatal.length === 0 && (
        <Card
          title={`2. Review ${rows.length} rows from ${fileName || 'pasted text'}`}
          subtitle={`${counts.newRows} new · ${counts.dup} duplicates of existing records · ${counts.inFile} duplicates within the file · ${counts.conflict} conflicts · ${counts.invalid} invalid · ${counts.warnings} with warnings`}
        >
          {analysis.droppedColumns.length > 0 && (
            <Callout tone="green">
              Privacy-safe pilot: not imported (kept only in the contractor’s system): <strong>{analysis.droppedColumns.join(', ')}</strong>.
            </Callout>
          )}
          {analysis.unknownColumns.length > 0 && <p className="mb-2 text-xs text-slate-500">Ignored columns: {analysis.unknownColumns.join(', ')}. Kept in each record's original import row.</p>}
          {missingHelpful.length > 0 && (
            <p className="mb-2 text-xs text-slate-600">Tip: the file has no {missingHelpful.join(' or ')} column. {missingHelpful.includes('notes') ? 'Notes like “waiting on adjuster” make the follow-ups personal.' : ''}</p>
          )}
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-y border-slate-100 bg-slate-50">
                <tr>
                  <th className={cx(th, 'ps-4')}>Row</th>
                  <th className={th}>Homeowner (normalised)</th>
                  <th className={cx(th, 'text-end')}>Estimate</th>
                  <th className={th}>Match</th>
                  <th className={th}>Will start as</th>
                  <th className={th}>Problems</th>
                  <th className={cx(th, 'pe-4')}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.rowNumber} className={cx(!r.parsed && 'bg-red-50/40', action(r) === 'skip' && r.parsed && 'text-slate-500')}>
                    <td className={cx(td, 'ps-4 tabular-nums text-slate-500')}>{r.rowNumber}</td>
                    <td className={td}>
                      <div className="font-medium">{r.parsed?.customerName ?? r.original.customer_name ?? '—'}</div>
                      <div className="text-xs text-slate-500">
                        {r.parsed ? [r.parsed.estimateRef ?? 'no estimate ID', r.parsed.email, r.parsed.phone ? formatPhone(r.parsed.phone) : null].filter(Boolean).join(' · ') : ''}
                      </div>
                      {r.parsed?.notes && <div className="text-xs text-slate-600 italic">“{r.parsed.notes}”</div>}
                    </td>
                    <td className={cx(td, 'text-end tabular-nums')}>{r.parsed ? formatUsd(r.parsed.estimateAmount) : r.original.estimate_amount || '—'}<div className="text-xs text-slate-500">{r.parsed?.estimateDate ?? r.original.estimate_date}</div></td>
                    <td className={td}>
                      {!r.parsed ? <Badge tone="red">Invalid</Badge> : <Badge tone={r.match.kind === 'new' ? 'green' : r.match.kind === 'conflict' ? 'red' : 'amber'}>{MATCH_LABEL[r.match.kind]}</Badge>}
                      {r.match.kind === 'duplicate' && (
                        <div className="mt-1 text-xs">
                          of <a className="text-navy-700 underline" href={href({ page: 'record', id: r.match.recordId })}>{r.match.recordName}</a> (on {r.match.on.join(' + ')})
                        </div>
                      )}
                      {r.match.kind === 'in_file_duplicate' && <div className="mt-1 text-xs">of row {r.match.ofRow}</div>}
                      {r.match.kind === 'conflict' && <div className="mt-1 max-w-56 text-xs text-red-800">{r.match.explanation}</div>}
                    </td>
                    <td className={td}>{r.initialEligibility && action(r) === 'import' ? <Badge tone={r.initialEligibility === 'pending_review' ? 'navy' : 'red'}>{ELIGIBILITY_SHORT[r.initialEligibility]}</Badge> : '—'}</td>
                    <td className={cx(td, 'max-w-80 text-xs')}>
                      {r.errors.map((e) => <div key={e} className="text-red-800">■ {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="text-amber-900">▲ {w}</div>)}
                      {r.differences.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-navy-800">{r.differences.length} field(s) differ from the existing record</summary>
                          <table className="mt-1">
                            <tbody>
                              {r.differences.map((d) => (
                                <tr key={d.field}>
                                  <td className="pe-2 text-slate-500">{d.label}</td>
                                  <td className="pe-2">{d.existing}</td>
                                  <td className="pe-2">→ {d.incoming}</td>
                                  <td className="text-slate-500">{d.updatable ? 'applied on update' : 'not applied — edit manually after review'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                    </td>
                    <td className={cx(td, 'pe-4')}>
                      {r.allowed.length > 1 ? (
                        <select aria-label={`Action for row ${r.rowNumber}`} className={cx(inputClass, 'w-40')} value={action(r)} onChange={(e) => setDecisions({ ...decisions, [r.rowNumber]: e.target.value as ImportAction })}>
                          {r.allowed.map((a) => <option key={a} value={a}>{a === 'import' ? 'Import' : a === 'update' ? 'Update existing' : r.match.kind === 'new' ? 'Exclude' : 'Keep existing (skip)'}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-500">Skipped</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <Button variant="primary" disabled={overLimit} onClick={commit}>
              Import {toImport} new{toUpdate ? `, update ${toUpdate}` : ''}
            </Button>
            <Button variant="ghost" onClick={() => { setText(''); setDecisions({}); setFileName(''); }}>Cancel</Button>
            <span className={cx('text-sm', overLimit ? 'text-red-800' : 'text-slate-500')}>
              {analysis.existingCount + toImport} of {analysis.recordLimit} agreed records after import{overLimit ? ' — exceeds the pilot limit; exclude rows' : ''}.
            </span>
            <Button variant="ghost" onClick={() => go({ page: 'records' })}>View records</Button>
          </div>
        </Card>
      )}

      <Card title="Import history" subtitle="Every import, including duplicate decisions, is in the audit log.">
        {state.imports.filter((i) => i.pilotId === pilot.id).length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b border-slate-100"><tr>{['File', 'Imported', 'Rows', 'New', 'Dup. kept', 'Dup. updated', 'In-file dup.', 'Conflicts', 'Invalid', 'Excluded'].map((h) => <th key={h} className={cx(th, h === 'File' && 'ps-4')}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {state.imports.filter((i) => i.pilotId === pilot.id).map((i) => (
                  <tr key={i.id}>
                    <td className={cx(td, 'ps-4')}>{i.fileName}</td>
                    <td className={td}>{new Date(i.importedAt).toLocaleDateString('en-US')}</td>
                    <td className={td}>{i.rows}</td><td className={td}>{i.imported}</td><td className={td}>{i.duplicatesSkipped}</td><td className={td}>{i.duplicatesUpdated}</td>
                    <td className={td}>{i.inFileDuplicates}</td><td className={td}>{i.conflictsSkipped}</td><td className={td}>{i.invalid}</td><td className={td}>{i.excludedByOperator}</td>
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
