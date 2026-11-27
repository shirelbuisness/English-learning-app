import { useState } from 'react';
import { formatDate } from '../domain/dates.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus, updateContractor, updatePilot, type ContractorInput, type PilotInput } from '../domain/setup.ts';
import { CHANNEL_LABELS, CHANNELS, CONTACT_MODE_LABELS, PILOT_STATUS_LABELS, TEMPLATE_LABELS, type Channel, type ContactMode, type Contractor, type Pilot, type PilotStatus } from '../domain/types.ts';
import { Badge, Button, Card, cx, Field, inputClass } from './shared.tsx';
import { now, type Workbench } from './useWorkbench.ts';

const emptyContractor: ContractorInput = { businessName: '', primaryContact: '', email: '', phone: '', timeZone: 'America/Chicago', notes: '' };

export function SetupPage({ wb, pilot, onSelectPilot }: { wb: Workbench; pilot: Pilot | null; onSelectPilot: (id: string) => void }) {
  const { state } = wb;
  const [editContractor, setEditContractor] = useState<Contractor | 'new' | null>(null);
  const [editPilot, setEditPilot] = useState<{ contractorId: string; pilot: Pilot | null } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Contractors &amp; pilots</h1>
          <p className="text-sm text-slate-500">
            A <strong>contractor</strong> holds business details and owns the suppression ledger. A <strong>pilot</strong> holds the engagement terms: dates, record limit, approved channels, policy, sequence and economics. Records, reports and time belong to one pilot.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditContractor('new')}>New contractor</Button>
      </div>

      {editContractor && (
        <ContractorForm
          initial={editContractor === 'new' ? emptyContractor : editContractor}
          onCancel={() => setEditContractor(null)}
          onSubmit={(input) => {
            const r = wb.run((s, c) => (editContractor === 'new' ? createContractor(s, input, c) : updateContractor(s, editContractor.id, input, c)));
            if (r.ok) setEditContractor(null);
          }}
        />
      )}

      {state.contractors.map((c) => {
        const pilots = state.pilots.filter((p) => p.contractorId === c.id);
        return (
          <Card
            key={c.id}
            title={<span className="flex flex-wrap items-center gap-2">{c.businessName}{c.isDemo && <Badge tone="amber">Demo</Badge>}</span>}
            subtitle={`${c.primaryContact} · ${c.phone || 'no phone'} · ${c.email || 'no email'} · ${c.timeZone}${c.notes ? ` · ${c.notes}` : ''}`}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditContractor(c)}>Edit</Button>
                <Button size="sm" onClick={() => setEditPilot({ contractorId: c.id, pilot: null })}>New pilot</Button>
              </div>
            }
          >
            {editPilot?.contractorId === c.id && c.isDemo && !editPilot.pilot && (
              <p className="mb-2 text-xs text-amber-900">Pilots under a sample contractor are demo data: “Load sample pipeline” and “Clear / start real pilot” delete them. Create a new contractor for real work.</p>
            )}
            {editPilot?.contractorId === c.id && (
              <PilotForm
                initial={editPilot.pilot ?? { ...defaultPilotInput(now().today), name: `Pilot ${pilots.length + 1}` }}
                isNew={!editPilot.pilot}
                onCancel={() => setEditPilot(null)}
                onSubmit={(input) => {
                  const r = wb.run((s, ck) => (editPilot.pilot ? updatePilot(s, editPilot.pilot.id, input, ck) : createPilot(s, c.id, input, ck)));
                  if (r.ok) {
                    if (!editPilot.pilot) onSelectPilot(r.state.pilots.at(-1)!.id);
                    setEditPilot(null);
                  }
                }}
              />
            )}
            {pilots.length === 0 ? (
              <p className="text-sm text-slate-500">No pilots yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pilots.map((p) => {
                  const n = state.records.filter((r) => r.pilotId === p.id).length;
                  return (
                    <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-navy-900">{p.name}</span>
                          <Badge tone={p.status === 'active' ? 'green' : p.status === 'setup' ? 'navy' : 'slate'}>{PILOT_STATUS_LABELS[p.status]}</Badge>
                          {pilot?.id === p.id && <Badge tone="plain">Working pilot</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDate(p.startDate)} – {formatDate(p.endDate)} · {n}/{p.recordLimit} records · channels: {p.approvedChannels.map((ch) => CHANNEL_LABELS[ch]).join(', ') || 'none'} · sequence: {p.sequence.map((s) => `day ${s.day} ${s.channel}`).join(', ')}
                        </div>
                        <div className="mt-1 max-w-3xl text-xs text-slate-600">Policy: {p.communicationPolicy || <span className="text-red-800">not recorded</span>}</div>
                        <div className="mt-0.5 max-w-3xl text-xs text-slate-600">
                          {CONTACT_MODE_LABELS[p.contactMode]}
                          {p.contactMode === 'contractor_system' &&
                            (p.contractorAttestation ? ` · contractor attestation recorded ${formatDate(p.contractorAttestation.recordedOn)}` : <span className="text-red-800"> · contractor attestation missing (required to activate)</span>)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pilot?.id !== p.id && <Button size="sm" variant="ghost" onClick={() => onSelectPilot(p.id)}>Work on this pilot</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setEditPilot({ contractorId: c.id, pilot: p })}>Edit</Button>
                        <StatusButtons p={p} onSet={(s) => wb.run((st, ck) => setPilotStatus(st, p.id, s, ck))} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function StatusButtons({ p, onSet }: { p: Pilot; onSet: (s: PilotStatus) => void }) {
  const next: Record<PilotStatus, PilotStatus[]> = { setup: ['active'], active: ['paused', 'completed'], paused: ['active', 'completed'], completed: [] };
  const label: Record<PilotStatus, string> = { setup: '', active: 'Activate', paused: 'Pause', completed: 'Mark completed' };
  return (
    <>
      {next[p.status].map((s) => (
        <Button key={s} size="sm" variant={s === 'active' ? 'confirm' : 'secondary'} onClick={() => (s !== 'completed' || window.confirm('Mark this pilot completed? Imports and outreach will be closed.')) && onSet(s)}>
          {label[s]}
        </Button>
      ))}
    </>
  );
}

function ContractorForm({ initial, onSubmit, onCancel }: { initial: ContractorInput; onSubmit: (i: ContractorInput) => void; onCancel: () => void }) {
  const [f, setF] = useState<ContractorInput>({ businessName: initial.businessName, primaryContact: initial.primaryContact, email: initial.email, phone: initial.phone, timeZone: initial.timeZone, notes: initial.notes });
  const set = (k: keyof ContractorInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title={initial.businessName ? `Edit ${initial.businessName}` : 'New contractor'}>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
        <Field label="Business name"><input className={inputClass} value={f.businessName} onChange={set('businessName')} /></Field>
        <Field label="Primary contact"><input className={inputClass} value={f.primaryContact} onChange={set('primaryContact')} /></Field>
        <Field label="Time zone" hint="IANA name, e.g. America/Chicago"><input className={inputClass} value={f.timeZone} onChange={set('timeZone')} /></Field>
        <Field label="Email"><input className={inputClass} value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input className={inputClass} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Internal notes"><input className={inputClass} value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex gap-2 sm:col-span-3"><Button type="submit" variant="primary">Save contractor</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
      </form>
    </Card>
  );
}

function PilotForm({ initial, isNew, onSubmit, onCancel }: { initial: PilotInput; isNew: boolean; onSubmit: (i: PilotInput) => void; onCancel: () => void }) {
  const [f, setF] = useState({ ...initial, recordLimit: String(initial.recordLimit), hourlyCost: String(initial.hourlyCost), revenue: String(initial.revenue), sequence: initial.sequence.map((s) => ({ ...s })) });
  const unapprovedSteps = f.sequence.filter((st) => !f.approvedChannels.includes(st.channel)).map((st) => st.step);
  const toggle = (c: Channel) => setF({ ...f, approvedChannels: f.approvedChannels.includes(c) ? f.approvedChannels.filter((x) => x !== c) : [...f.approvedChannels, c] });
  return (
    <form
      className="mb-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...f, recordLimit: Number(f.recordLimit), hourlyCost: Number(f.hourlyCost), revenue: Number(f.revenue) });
      }}
    >
      <div className="text-sm font-semibold text-navy-900 sm:col-span-4">{isNew ? 'New pilot' : `Edit ${initial.name}`}</div>
      <Field label="Pilot name" className="sm:col-span-2"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Start date"><input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
      <Field label="End date"><input type="date" className={inputClass} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      <Field label="Agreed record limit"><input inputMode="numeric" className={inputClass} value={f.recordLimit} onChange={(e) => setF({ ...f, recordLimit: e.target.value })} /></Field>
      <Field label="Hourly cost assumption (USD)"><input inputMode="decimal" className={inputClass} value={f.hourlyCost} onChange={(e) => setF({ ...f, hourlyCost: e.target.value })} /></Field>
      <Field label="Pilot revenue (USD)"><input inputMode="decimal" className={inputClass} value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} /></Field>
      <fieldset className="text-xs text-slate-600">
        <legend className="mb-1 font-medium">Approved channels</legend>
        <div className="flex flex-wrap gap-3">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm text-slate-800"><input type="checkbox" className="size-4 accent-navy-800" checked={f.approvedChannels.includes(c)} onChange={() => toggle(c)} />{CHANNEL_LABELS[c]}</label>
          ))}
        </div>
      </fieldset>
      <fieldset className="text-sm sm:col-span-4">
        <legend className="mb-1 text-xs font-medium text-slate-600">Where do homeowner contact details live?</legend>
        <div className="flex flex-wrap gap-4">
          {(['contractor_system', 'in_workbench'] as ContactMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" name="contactMode" className="accent-navy-800" checked={f.contactMode === m} onChange={() => setF({ ...f, contactMode: m })} />
              {CONTACT_MODE_LABELS[m]}{m === 'contractor_system' && <span className="text-xs text-sage-700"> (recommended)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {f.contactMode === 'contractor_system' && (
        <div className="grid gap-2 rounded-md border border-sage-100 bg-white p-3 sm:col-span-4 sm:grid-cols-4">
          <Field label="What the contractor confirmed (contact permission)" className="sm:col-span-3" hint="E.g. “Every homeowner on the list asked us for an estimate and may be followed up by email or text. Anyone who opted out was left off.” Needed before activation.">
            <textarea rows={2} className={inputClass} value={f.contractorAttestation?.text ?? ''} onChange={(e) => setF({ ...f, contractorAttestation: e.target.value.trim() ? { text: e.target.value, recordedOn: f.contractorAttestation?.recordedOn ?? now().today } : null })} />
          </Field>
          <Field label="Date confirmed">
            <input type="date" className={inputClass} value={f.contractorAttestation?.recordedOn ?? ''} disabled={!f.contractorAttestation} onChange={(e) => f.contractorAttestation && setF({ ...f, contractorAttestation: { ...f.contractorAttestation, recordedOn: e.target.value } })} />
          </Field>
        </div>
      )}
      <Field label="Approved communication policy / templates" className="sm:col-span-4" hint="What the contractor approved: who may be contacted, how, and the message templates. Required before activation.">
        <textarea rows={3} className={inputClass} value={f.communicationPolicy} onChange={(e) => setF({ ...f, communicationPolicy: e.target.value })} />
      </Field>
      {unapprovedSteps.length > 0 && (
        <p className="text-xs text-amber-900 sm:col-span-4">
          Step {unapprovedSteps.join(' and ')} {unapprovedSteps.length === 1 ? 'uses a channel' : 'use channels'} not approved above. Those steps will use an approved channel instead. Tick the channel, or change the step.
        </p>
      )}
      <div className="sm:col-span-4">
        <div className="mb-1 text-xs font-medium text-slate-600">Sequence guidance (experimental defaults; used only where the channel is permitted)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {f.sequence.map((s, i) => (
            <div key={s.step} className="flex items-end gap-2 rounded border border-slate-200 bg-white p-2 text-sm">
              <span className="pb-1.5 font-medium text-navy-900">Step {s.step}</span>
              <Field label="Day"><input inputMode="numeric" className={cx(inputClass, 'w-16')} value={s.day} onChange={(e) => setF({ ...f, sequence: f.sequence.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) || 0 } : x)) })} /></Field>
              <Field label="Channel">
                <select className={inputClass} value={s.channel} onChange={(e) => setF({ ...f, sequence: f.sequence.map((x, j) => (j === i ? { ...x, channel: e.target.value as Channel } : x)) })}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                </select>
              </Field>
              <span className="pb-1.5 text-xs text-slate-500">{TEMPLATE_LABELS[s.template]}</span>
            </div>
          ))}
        </div>
      </div>
      <Field label="Internal notes" className="sm:col-span-4"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="flex gap-2 sm:col-span-4"><Button type="submit" variant="primary">{isNew ? 'Create pilot' : 'Save pilot'}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
