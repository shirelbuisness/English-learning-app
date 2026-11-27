import { describe, expect, it } from 'vitest';
import { SAMPLE_ESTIMATES, withSamplePipeline } from '../data/samplePipeline.ts';
import { withDemoData } from '../data/demoSeed.ts';
import { createLocalStore, STORAGE_KEY } from '../storage/localStore.ts';
import { addDays, daysBetween } from './dates.ts';
import { analyzeImport, commitImport, mapHeader, parseFlexibleDate, sampleEstimatesCsv } from './importer.ts';
import { buildQueue } from './queue.ts';
import { approveDrafts, confirmContact, openTouch, prepareDraft, setEligibility, submitForApproval, suppressRecord } from './records.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus } from './setup.ts';
import { emptyState, must } from './state.ts';
import { draftText, situationFromNotes } from './templates.ts';
import { approvalBatch, warmLeadCard } from './touchpoints.ts';
import type { WorkbenchState } from './types.ts';
import { clock, eligible, fixture, importRows, rec, row, TODAY } from './testkit.ts';

const ATTEST = { text: 'Contractor confirmed all homeowners requested an estimate and may be followed up.', recordedOn: TODAY };

/** A privacy-safe pilot (contact details stay in the contractor's system). */
function privacyPilot(attest = true): { s: WorkbenchState; contractorId: string; pilotId: string } {
  let s = must(createContractor(emptyState(), { businessName: 'Ridge Roofing', primaryContact: 'Wade Collins', email: '', phone: '(512) 555-0100', timeZone: 'America/Chicago', notes: '' }, clock));
  const contractorId = s.contractors[0]!.id;
  s = must(createPilot(s, contractorId, { ...defaultPilotInput(TODAY), name: 'Founding pilot', approvedChannels: ['email', 'sms'], communicationPolicy: 'Approved by owner', endDate: '2026-12-31', contractorAttestation: attest ? ATTEST : null }, clock));
  const pilotId = s.pilots[0]!.id;
  if (attest) s = must(setPilotStatus(s, pilotId, 'active', clock));
  return { s, contractorId, pilotId };
}

const MESSY = [
  'Quote #,First Name,Job Type,Total,Date Sent,Comments',
  'q-101,Sarah,Full replacement,"$18,400.00",10/28/2026,Waiting on adjuster',
  'Q-102,Mike,Re-roof + metal accent,"$22,000",11/1/26,Getting 2nd bid',
  'Q-103,Linda,Hail claim,14900,2026-11-05,Husband/wife deciding',
].join('\n');

describe('flexible, privacy-safe import', () => {
  it('maps messy real-world headers and formats', () => {
    expect(mapHeader('Quote #')).toBe('estimate_ref');
    expect(mapHeader('First Name')).toBe('customer_name');
    expect(mapHeader('Days Since Sent')).toBe('days_since_sent');
    expect(mapHeader('Total')).toBe('estimate_amount');
    expect(mapHeader('Last Name')).toBeNull();
    expect(parseFlexibleDate('11/1/26')).toBe('2026-11-01');
    expect(parseFlexibleDate('2/30/2026')).toBeNull();
    const { s, pilotId } = privacyPilot();
    const n = must(commitImport(s, pilotId, MESSY, 'crm-export.csv', {}, clock));
    const sarah = rec(n, 'Sarah');
    expect(sarah).toMatchObject({ estimateRef: 'Q-101', estimateAmount: 18400, estimateDate: '2026-10-28', notes: 'Waiting on adjuster', email: null, phone: null, estimateStatus: 'open' });
    expect(rec(n, 'Mike').estimateDate).toBe('2026-11-01');
  });

  it('accepts the minimal sample format (ID, first name, scope, amount, days since sent, notes)', () => {
    const { s, pilotId } = privacyPilot();
    const a = analyzeImport(s, pilotId, sampleEstimatesCsv(), TODAY);
    expect(a.fatal).toEqual([]);
    expect(a.rows.every((r) => r.errors.length === 0 && r.defaultAction === 'import')).toBe(true);
    expect(a.missingOptionalColumns).not.toContain('customer_email');
    const n = must(commitImport(s, pilotId, sampleEstimatesCsv(), 'sample.csv', {}, clock));
    expect(daysBetween(n.records[0]!.estimateDate, TODAY)).toBe(21);
  });

  it('requires some identifier column, and explains missing columns using the headers it found', () => {
    const { s, pilotId } = privacyPilot();
    expect(analyzeImport(s, pilotId, 'First Name,Total,Days Since Sent\nSam,9000,20', TODAY).fatal[0]).toMatch(/estimate ID column/);
    expect(analyzeImport(s, pilotId, 'Quote #,Total\nQ-1,9000', TODAY).fatal[0]).toMatch(/Columns found: Quote #, Total/);
    expect(analyzeImport(s, pilotId, 'Name,Customer,Total,Days\nA,B,1,2', TODAY).fatal[0]).toMatch(/both look like customer_name/);
  });

  it('deduplicates on estimate ID (case/space-insensitive) and stays safe on re-import', () => {
    const { s, pilotId } = privacyPilot();
    let n = must(commitImport(s, pilotId, MESSY, 'a.csv', {}, clock));
    const before = structuredClone(n.records);
    const again = MESSY.replace('q-101', ' Q-101 ');
    n = must(commitImport(n, pilotId, again, 'b.csv', {}, clock));
    expect(n.records).toEqual(before);
    expect(n.imports.at(-1)).toMatchObject({ imported: 0, duplicatesSkipped: 3 });
  });

  it('flags a conflict when the estimate ID and email point to different records', () => {
    const f = fixture();
    const n = importRows(f.s, f.pilotId, [row({ estimate_ref: 'Q-1' }), row({ customer_name: 'Bo', estimate_ref: 'Q-2', customer_email: 'bo@example.com', customer_phone: '' })]);
    const a = analyzeImport(n, f.pilotId, 'estimate_ref,customer_name,customer_email,estimate_date,estimate_amount\nQ-1,X,bo@example.com,2026-10-01,100', TODAY);
    expect(a.rows[0]!.match.kind).toBe('conflict');
  });

  it('status: no status column means the list is unsold quotes; a blank status cell needs review', () => {
    const { s, pilotId } = privacyPilot();
    const n = must(commitImport(s, pilotId, 'Quote #,First Name,Total,Days,Status\nQ-9,Ann,9000,20,', 'x.csv', {}, clock));
    expect(rec(n, 'Ann').estimateStatus).toBe('unknown');
  });
});

describe('privacy-safe eligibility', () => {
  it('cannot activate or mark eligible without the contractor attestation', () => {
    const { s, pilotId } = privacyPilot(false);
    expect(setPilotStatus(s, pilotId, 'active', clock).ok).toBe(false);
    const n = must(commitImport(s, pilotId, MESSY, 'a.csv', {}, clock));
    const r = setEligibility(n, rec(n, 'Sarah').id, 'eligible', '', clock);
    expect(!r.ok && r.error).toMatch(/attestation/);
  });

  it('with the attestation, works without any phone or email; an explicit "no" still blocks that channel', () => {
    const { s, pilotId } = privacyPilot();
    let n = must(commitImport(s, pilotId, MESSY + '\nQ-104,Tom,Repair,9500,2026-11-01,No texts please', 'a.csv', {}, clock));
    n = must(commitImport(n, pilotId, 'Quote #,First Name,Total,Days,SMS consent\nQ-104,Tom,9500,24,no', 'b.csv', {}, clock)); // duplicate: consent not auto-applied
    n = eligible(n, 'Sarah');
    n = must(prepareDraft(n, rec(n, 'Sarah').id, clock, 'sms'));
    expect(openTouch(rec(n, 'Sarah'))!.channel).toBe('sms');
    const noSms = must(commitImport(privacyPilot().s, privacyPilot().pilotId, 'Quote #,First Name,Total,Days,SMS consent\nQ-7,Jo,9500,24,no', 'c.csv', {}, clock));
    const jo = must(setEligibility(noSms, rec(noSms, 'Jo').id, 'eligible', '', clock));
    expect(prepareDraft(jo, rec(jo, 'Jo').id, clock, 'sms').ok).toBe(false);
    expect(prepareDraft(jo, rec(jo, 'Jo').id, clock, 'email').ok).toBe(true);
  });

  it('a record without an estimate ID cannot be marked eligible (it could not be found in the contractor system)', () => {
    const { s, pilotId } = privacyPilot();
    const n = must(commitImport(s, pilotId, 'Quote #,First Name,Total,Days,Email\n,Ann,9000,20,ann@example.com', 'x.csv', {}, clock));
    expect(setEligibility(n, rec(n, 'Ann').id, 'eligible', '', clock).ok).toBe(false);
  });

  it('suppression by estimate ID carries across pilots of the same contractor and survives re-import', () => {
    const p = privacyPilot();
    let n = must(commitImport(p.s, p.pilotId, MESSY, 'a.csv', {}, clock));
    n = must(suppressRecord(n, rec(n, 'Sarah').id, { reason: 'Texted STOP', channel: 'sms', date: TODAY, source: 'homeowner' }, clock));
    expect(n.suppression[0]).toMatchObject({ estimateRef: 'Q-101', email: null, phone: null, active: true });
    n = must(createPilot(n, p.contractorId, { ...defaultPilotInput(TODAY), name: 'Second batch', approvedChannels: ['email'], communicationPolicy: 'x', endDate: '2026-12-31', contractorAttestation: ATTEST }, clock));
    const p2 = n.pilots.at(-1)!.id;
    n = must(commitImport(n, p2, MESSY, 'again.csv', {}, clock));
    expect(rec(n, 'Sarah', p2).eligibility.status).toBe('suppressed');
    expect(rec(n, 'Mike', p2).eligibility.status).toBe('pending_review');
  });
});

describe('follow-up drafts', () => {
  it('picks a natural angle from the contractor notes', () => {
    expect(situationFromNotes('Waiting on adjuster')).toBe('insurance');
    expect(situationFromNotes('Adjuster approved, waiting on first check')).toBe('claim_approved');
    expect(situationFromNotes('Getting 2nd bid')).toBe('comparing');
    expect(situationFromNotes('Husband/wife deciding')).toBe('deciding');
    expect(situationFromNotes('Asked about financing')).toBe('budget');
    expect(situationFromNotes('')).toBe('seasonal');
  });

  it('texts are short, include an opt-out, and nothing is pushy', () => {
    const s = withSamplePipeline(emptyState(), TODAY);
    const contractor = s.contractors[0]!;
    for (const r of s.records) {
      for (const template of ['initial', 'unanswered', 'final'] as const) {
        const sms = draftText(template, 'sms', r, contractor);
        expect(sms.length).toBeLessThanOrEqual(320);
        expect(sms).toMatch(/Reply STOP to opt out/);
        const email = draftText(template, 'email', r, contractor);
        for (const text of [sms, email]) expect(text).not.toMatch(/guarantee|act now|limited time|discount|last chance|urgent/i);
      }
    }
  });
});

describe('zero-login touchpoints', () => {
  it('approval batch lists every prepared draft, numbered, and nothing else', () => {
    const s = withSamplePipeline(emptyState(), TODAY);
    const pid = s.pilots[0]!.id;
    const b = approvalBatch(s, pid);
    expect(b.items.map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(b.text).toMatch(/Reply "Approved"/);
    expect(b.text).toMatch(/1\) Q-2236 · Mike · \$22,000 · Email/);
    expect(b.text).not.toMatch(/Sarah|Robert|Karen|Tom/); // contacted, in review or excluded
    expect(b.text).not.toMatch(/@|\(\d{3}\) 555-01[0-7]\d/); // no homeowner contact details
    // Approving the batch revalidates each draft and leaves none pending.
    let n = must(submitForApproval(s, b.items.map((i) => i.touchId), clock));
    n = must(approveDrafts(n, b.items.map((i) => i.touchId), clock));
    expect(approvalBatch(n, pid).items).toEqual([]);
    expect(approvalBatch(n, pid).text).toBe('');
  });

  it('warm lead card has what the contractor needs, and no contact details in privacy-safe mode', () => {
    const s = withSamplePipeline(emptyState(), TODAY);
    const sarah = s.records.find((r) => r.estimateRef === 'Q-2231')!;
    const card = warmLeadCard(s, sarah.id, TODAY)!;
    expect(card).toMatch(/WARM LEAD/);
    expect(card).toMatch(/Q-2231/);
    expect(card).toMatch(/\$18,400/);
    expect(card).toMatch(/Adjuster finally approved the claim/);
    expect(card).not.toMatch(/Sent from Lone Star inbox/);
    expect(card).toMatch(/Contact: in your system under Q-2231/);
    expect(warmLeadCard(s, s.records.find((r) => r.estimateRef === 'Q-2258')!.id, TODAY)).toBeNull(); // no reply yet
    const suppressed = must(suppressRecord(s, sarah.id, { reason: 'Asked to stop', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    expect(warmLeadCard(suppressed, sarah.id, TODAY)).toBeNull();
  });

  it('warm lead card includes contact details when they are kept in the workbench', () => {
    const f = fixture();
    let n = eligible(importRows(f.s, f.pilotId, [row()]), 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const t = openTouch(rec(n, 'Alex Rivera'))!.id;
    n = must(submitForApproval(n, [t], clock));
    n = must(approveDrafts(n, [t], clock));
    n = must(confirmContact(n, t, { confirmed: true, contactedOn: TODAY, channel: 'email', outcome: 'inspection', notes: 'Come look Friday' }, clock));
    expect(warmLeadCard(n, rec(n, 'Alex Rivera').id, TODAY)).toMatch(/Contact: \(512\) 555-0150 · alex.rivera@example.com/);
  });
});

describe('sample roofing pipeline', () => {
  it('has 10 realistic, privacy-safe estimates covering the whole lifecycle', () => {
    const s = withSamplePipeline(emptyState(), TODAY);
    const recs = s.records;
    expect(recs).toHaveLength(SAMPLE_ESTIMATES.length);
    expect(recs).toHaveLength(10);
    for (const r of recs) {
      expect(r.estimateAmount).toBeGreaterThanOrEqual(9500);
      expect(r.estimateAmount).toBeLessThanOrEqual(22000);
      const age = daysBetween(r.estimateDate, TODAY);
      expect(age).toBeGreaterThanOrEqual(14);
      expect(age).toBeLessThanOrEqual(48);
      expect(r.email).toBeNull();
      expect(r.phone).toBeNull();
      expect(r.notes).not.toBe('');
    }
    const kinds = buildQueue(s, TODAY).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'finish_draft')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'reply')).toHaveLength(1);
    expect(kinds).toContain('review');
    const channels = recs.flatMap((r) => r.touches.filter((t) => t.status === 'draft').map((t) => t.channel));
    expect(new Set(channels)).toEqual(new Set(['email', 'sms']));
  });

  it('replaces any demo data but never touches operator pilots, and builds on any date', () => {
    const op = privacyPilot();
    const withOp = must(commitImport(op.s, op.pilotId, MESSY, 'real.csv', {}, clock));
    const s = withSamplePipeline(withDemoData(withOp, TODAY), TODAY);
    expect(s.pilots.map((p) => p.name).sort()).toEqual(['Founding Partner Pilot (sample)', 'Founding pilot']);
    expect(s.records.filter((r) => r.pilotId === op.pilotId)).toEqual(withOp.records);
    for (let i = 0; i < 366; i += 23) expect(() => withSamplePipeline(emptyState(), addDays('2026-01-01', i))).not.toThrow();
  });
});

describe('saved data from before privacy-safe mode', () => {
  it('loads with safe defaults: old pilots keep per-contact consent rules', () => {
    const mem = new Map<string, string>();
    const store = createLocalStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    const old = JSON.parse(JSON.stringify(withDemoData(emptyState(), TODAY)));
    for (const p of old.pilots) { delete p.contactMode; delete p.contractorAttestation; }
    for (const r of old.records) { delete r.estimateRef; delete r.notes; }
    mem.set(STORAGE_KEY, JSON.stringify(old));
    const loaded = store.load().state!;
    expect(loaded.pilots.every((p) => p.contactMode === 'in_workbench' && p.contractorAttestation === null)).toBe(true);
    expect(loaded.records.every((r) => r.estimateRef === null && r.notes === '')).toBe(true);
  });
});

describe('privacy-safe import keeps nothing extra', () => {
  it('drops contact and unrecognised columns entirely, and says so', () => {
    const { s, pilotId } = privacyPilot();
    const text = 'Quote #,First Name,Last Name,Phone,Email,Street Address,Total,Days,Notes\nQ-1,Ann,Smith,512-555-0101,ann@example.com,12 Oak St,9000,20,Getting 2nd bid';
    const a = analyzeImport(s, pilotId, text, TODAY);
    expect(a.droppedColumns).toEqual(['Last Name', 'Phone', 'Email', 'Street Address']);
    const n = must(commitImport(s, pilotId, text, 'x.csv', {}, clock));
    const ann = rec(n, 'Ann');
    expect(ann.email).toBeNull();
    expect(ann.phone).toBeNull();
    expect(JSON.stringify(n)).not.toMatch(/Smith|555-0101|ann@example\.com|Oak St/);
    expect(Object.keys(ann.original).sort()).toEqual(['customer_name', 'days_since_sent', 'estimate_amount', 'estimate_ref', 'notes']);
  });
});

describe('privacy-safe record edits', () => {
  it('refuses phone numbers or emails on a privacy-safe pilot', async () => {
    const { updateRecordDetails } = await import('./records.ts');
    const { s, pilotId } = privacyPilot();
    const n = must(commitImport(s, pilotId, MESSY, 'a.csv', {}, clock));
    const r = rec(n, 'Sarah');
    const res = updateRecordDetails(n, r.id, { email: 'sarah@example.com', phone: '', authorization: r.authorization }, clock);
    expect(!res.ok && res.error).toMatch(/privacy-safe/);
    expect(updateRecordDetails(n, r.id, { email: '', phone: '', authorization: { ...r.authorization, smsConsent: 'no' } }, clock).ok).toBe(true);
  });
});

describe('docs/sample-estimates.csv', () => {
  it('imports cleanly into a privacy-safe pilot and matches the in-app sample', async () => {
    const text = (await import('../../docs/sample-estimates.csv?raw')).default;
    const { s, pilotId } = privacyPilot();
    const a = analyzeImport(s, pilotId, text, TODAY);
    expect(a.fatal).toEqual([]);
    expect(a.rows).toHaveLength(SAMPLE_ESTIMATES.length);
    expect(a.rows.every((r) => r.errors.length === 0 && r.warnings.length === 0)).toBe(true);
    expect(a.rows.map((r) => r.parsed!.estimateRef)).toEqual(SAMPLE_ESTIMATES.map((e) => e[0]));
  });
});
