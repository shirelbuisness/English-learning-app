import { describe, expect, it } from 'vitest';
import { analyzeImport, commitImport, templateCsv } from './importer.ts';
import { normalizeConsent, normalizeEmail, normalizePhone } from './normalize.ts';
import { prepareDraft, submitForApproval, approveDrafts, suppressRecord, openTouch } from './records.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus, updatePilot } from './setup.ts';
import { emptyState, must } from './state.ts';
import { addPilot, clock, csv, eligible, fixture, importRows, rec, row, TODAY } from './testkit.ts';

describe('normalisation', () => {
  it('normalises email and US phone numbers', () => {
    expect(normalizeEmail('  Alex.Rivera@Example.COM ')).toEqual({ value: 'alex.rivera@example.com', invalid: false });
    expect(normalizeEmail('not-an-email').invalid).toBe(true);
    expect(normalizePhone('(512) 555-0150').value).toBe('+15125550150');
    expect(normalizePhone('1-512-555-0150').value).toBe('+15125550150');
    expect(normalizePhone('512.555.0150').value).toBe('+15125550150');
    expect(normalizePhone('555-0150').invalid).toBe(true);
  });

  it('never treats missing or unclear authorization as permission', () => {
    expect(normalizeConsent('').value).toBe('unknown');
    expect(normalizeConsent('maybe')).toEqual({ value: 'unknown', recognised: false });
    expect(normalizeConsent('Yes').value).toBe('yes');
  });
});

describe('CSV template and validation', () => {
  it('the downloadable template imports cleanly', () => {
    const { s, pilotId } = fixture();
    const a = analyzeImport(s, pilotId, templateCsv(), TODAY);
    expect(a.fatal).toEqual([]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]!.errors).toEqual([]);
    expect(a.rows[0]!.defaultAction).toBe('import');
  });

  it.each([
    ['', 'The file is empty.'],
    ['name,city\nx,y', 'Missing required column'],
    ['customer_name,estimate_date,estimate_amount\nA,2026-10-01,100', 'customer_email or customer_phone'],
    [`${csv([]).trim()}\n`, 'no rows'],
    ['customer_name,customer_name,estimate_date,estimate_amount,customer_email\n', 'Duplicate column'],
    ['\u0000\u0001binary', 'text CSV'],
  ])('rejects malformed file %#', (text, message) => {
    const { s, pilotId } = fixture();
    const a = analyzeImport(s, pilotId, text, TODAY);
    expect(a.fatal.join(' ')).toContain(message);
    expect(commitImport(s, pilotId, text, 'x.csv', {}, clock).ok).toBe(false);
  });

  it('reports row-level errors without crashing, and invalid rows cannot be imported', () => {
    const { s, pilotId } = fixture();
    const text = csv([
      row({ customer_name: '' }),
      row({ customer_email: 'b@example.com', customer_phone: '', estimate_date: '10/12/2026' }),
      row({ customer_email: 'c@example.com', customer_phone: '', estimate_amount: 'abc' }),
      row({ customer_email: 'd@example.com', customer_phone: '', estimate_date: '2027-01-01' }),
      row({ customer_email: 'e@example.com', customer_phone: '', prior_opt_out: 'perhaps' }),
    ]) + '"unterminated,quote\n';
    const a = analyzeImport(s, pilotId, text, TODAY);
    expect(a.fatal).toEqual([]);
    const errs = a.rows.map((r) => r.errors.join('; '));
    expect(errs[0]).toContain('customer_name is required');
    expect(errs[1]).toContain('must be YYYY-MM-DD');
    expect(errs[2]).toContain('not a valid dollar amount');
    expect(errs[3]).toContain('in the future');
    expect(errs[4]).toContain('prior_opt_out');
    expect(errs[5]).toContain('Expected 20 fields');
    for (const r of a.rows) expect(r.allowed).toEqual(['skip']);
    const forced = commitImport(s, pilotId, text, 'x.csv', { 2: 'import' }, clock);
    expect(forced.ok).toBe(false);
  });

  it('flags missing contact details and authorization, and imports them as pending review', () => {
    const { s, pilotId } = fixture();
    const n = importRows(s, pilotId, [
      row({ customer_name: 'No Contact', customer_email: '', customer_phone: '' }),
      row({ customer_name: 'No Auth', customer_email: 'na@example.com', customer_phone: '', email_consent: '', phone_consent: '', sms_consent: '', authorization_evidence: '' }),
      row({ customer_name: 'Bad Email', customer_email: 'bad@', customer_phone: '512-555-0177' }),
    ]);
    for (const name of ['No Contact', 'No Auth', 'Bad Email']) expect(rec(n, name).eligibility.status).toBe('pending_review');
    expect(rec(n, 'Bad Email').email).toBeNull();
    expect(rec(n, 'Bad Email').original.customer_email).toBe('bad@');
    expect(rec(n, 'No Auth').authorization.emailConsent).toBe('unknown');
  });

  it('sets initial restrictions from the file: opt-out, exclusion, sold', () => {
    const { s, pilotId, contractorId } = fixture();
    const n = importRows(s, pilotId, [
      row({ customer_name: 'Opted', customer_email: 'o@example.com', customer_phone: '', prior_opt_out: 'yes' }),
      row({ customer_name: 'Excl', customer_email: 'x@example.com', customer_phone: '', contractor_exclude: 'yes' }),
      row({ customer_name: 'Sold', customer_email: 's@example.com', customer_phone: '', estimate_status: 'sold' }),
    ]);
    expect(rec(n, 'Opted').eligibility.status).toBe('suppressed');
    expect(n.suppression.filter((e) => e.contractorId === contractorId && e.email === 'o@example.com')).toHaveLength(1);
    expect(rec(n, 'Excl').eligibility.status).toBe('excluded');
    expect(rec(n, 'Sold').eligibility.status).toBe('ineligible');
  });

  it('enforces the pilot record limit', () => {
    const { s, pilotId } = fixture();
    const small = must(updatePilot(s, pilotId, { ...defaultPilotInput(TODAY), name: 'Small', recordLimit: 2, approvedChannels: ['email', 'phone'], communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    const rows = [1, 2, 3].map((i) => row({ customer_name: `P${i}`, customer_email: `p${i}@example.com`, customer_phone: '' }));
    const r = commitImport(small, pilotId, csv(rows), 'x.csv', {}, clock);
    expect(!r.ok && r.error).toMatch(/exceed the pilot limit of 2/);
    expect(commitImport(small, pilotId, csv(rows), 'x.csv', { 4: 'skip' }, clock).ok).toBe(true);
  });
});

describe('deduplication', () => {
  it('detects in-file duplicates by normalised email or phone', () => {
    const { s, pilotId } = fixture();
    const a = analyzeImport(s, pilotId, csv([row(), row({ customer_email: 'ALEX.RIVERA@example.com', customer_phone: '' }), row({ customer_email: 'other@example.com', customer_phone: '512.555.0150' })]), TODAY);
    expect(a.rows.map((r) => r.match.kind)).toEqual(['new', 'in_file_duplicate', 'in_file_duplicate']);
  });

  it('re-importing unchanged data is safe: no new records, no state changes', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row(), row({ customer_name: 'Bo', customer_email: 'bo@example.com', customer_phone: '' })]);
    n = eligible(n, 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const before = structuredClone(n.records);
    const again = must(commitImport(n, pilotId, csv([row(), row({ customer_name: 'Bo', customer_email: 'bo@example.com', customer_phone: '' })]), 'again.csv', {}, clock));
    expect(again.records).toEqual(before);
    expect(again.imports.at(-1)).toMatchObject({ imported: 0, duplicatesSkipped: 2 });
  });

  it('shows differing fields and applies only estimate details on "update", preserving history', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = eligible(n, 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const changed = row({ customer_name: 'Alexander Rivera', estimate_amount: '19500', email_consent: 'no' });
    const a = analyzeImport(n, pilotId, csv([changed]), TODAY);
    const r = a.rows[0]!;
    expect(r.match.kind).toBe('duplicate');
    expect(r.differences.map((d) => [d.label, d.updatable])).toEqual([
      ['Name', false],
      ['Estimate amount', true],
      ['Email consent', false],
    ]);
    expect(r.defaultAction).toBe('skip');
    const u = must(commitImport(n, pilotId, csv([changed]), 'u.csv', { 2: 'update' }, clock));
    const after = rec(u, 'Alex Rivera');
    expect(after.estimateAmount).toBe(19500);
    expect(after.authorization.emailConsent).toBe('yes'); // not overwritten
    expect(after.eligibility.status).toBe('eligible'); // not reset
    expect(after.touches).toHaveLength(1);
    expect(after.version).toBeGreaterThan(rec(n, 'Alex Rivera').version);
    expect(u.events.some((e) => e.type === 'duplicate_updated')).toBe(true);
  });

  it('requires manual review when email and phone match different records', () => {
    const { s, pilotId } = fixture();
    const n = importRows(s, pilotId, [row(), row({ customer_name: 'Bo', customer_email: 'bo@example.com', customer_phone: '512-555-0160' })]);
    const conflict = row({ customer_name: 'Mix', customer_email: 'bo@example.com', customer_phone: '(512) 555-0150' });
    const a = analyzeImport(n, pilotId, csv([conflict]), TODAY);
    expect(a.rows[0]!.match.kind).toBe('conflict');
    expect(a.rows[0]!.allowed).toEqual(['skip']);
    expect(commitImport(n, pilotId, csv([conflict]), 'c.csv', { 2: 'import' }, clock).ok).toBe(false);
    expect(commitImport(n, pilotId, csv([conflict]), 'c.csv', { 2: 'update' }, clock).ok).toBe(false);
  });

  it('never merges on similar names alone', () => {
    const { s, pilotId } = fixture();
    const n = importRows(s, pilotId, [row()]);
    const a = analyzeImport(n, pilotId, csv([row({ customer_email: 'different@example.com', customer_phone: '512-555-0199' })]), TODAY);
    expect(a.rows[0]!.match.kind).toBe('new');
  });

  it('never resurrects a suppressed or excluded record through re-import', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row(), row({ customer_name: 'Ex', customer_email: 'ex@example.com', customer_phone: '', contractor_exclude: 'yes' })]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'Asked not to be contacted', channel: 'phone', date: TODAY, source: 'homeowner' }, clock));
    for (const decision of ['skip', 'update'] as const) {
      const text = csv([row({ estimate_amount: '20000' }), row({ customer_name: 'Ex', customer_email: 'ex@example.com', customer_phone: '', contractor_exclude: 'no', estimate_amount: '9' })]);
      const r = commitImport(n, pilotId, text, 'r.csv', { 2: decision, 3: decision }, clock);
      const after = r.ok ? r.state : n;
      expect(rec(after, 'Alex Rivera').eligibility.status).toBe('suppressed');
      expect(rec(after, 'Ex').eligibility.status).toBe('excluded');
    }
  });

  it('a re-import reporting an opt-out tightens an existing record', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = eligible(n, 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const u = must(commitImport(n, pilotId, csv([row({ prior_opt_out: 'yes' })]), 'u.csv', { 2: 'update' }, clock));
    expect(rec(u, 'Alex Rivera').eligibility.status).toBe('suppressed');
    expect(rec(u, 'Alex Rivera').touches[0]!.status).toBe('blocked');
  });
});

describe('pilot isolation and the suppression ledger', () => {
  it('deduplicates within a pilot only and keeps pilots separate', () => {
    const { s, contractorId, pilotId } = fixture();
    const a = importRows(s, pilotId, [row()]);
    const { s: s2, pilotId: p2 } = addPilot(a, contractorId, 'Second pilot');
    const b = importRows(s2, p2, [row({ estimate_amount: '5000' })]);
    expect(b.records.filter((r) => r.customerName === 'Alex Rivera')).toHaveLength(2);
    expect(rec(b, 'Alex Rivera', pilotId).estimateAmount).toBe(18000);
  });

  it('a suppressed contact is suppressed when imported into another pilot of the same contractor', () => {
    const { s, contractorId, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'Opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    const { s: s2, pilotId: p2 } = addPilot(n, contractorId, 'Second pilot');
    const a = analyzeImport(s2, p2, csv([row({ customer_email: '', customer_phone: '512 555 0150' })]), TODAY);
    expect(a.rows[0]!.ledgerSuppressed).toBe(true);
    const m = importRows(s2, p2, [row({ customer_email: '', customer_phone: '512 555 0150' })]);
    expect(rec(m, 'Alex Rivera', p2).eligibility.status).toBe('suppressed');
  });

  it("the ledger is scoped to the contractor (another contractor's list is unaffected)", () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = must(suppressRecord(n, rec(n, 'Alex Rivera').id, { reason: 'Opt-out', channel: 'email', date: TODAY, source: 'homeowner' }, clock));
    n = must(createContractor(n, { businessName: 'Other Co', primaryContact: 'Sam', email: '', phone: '', timeZone: 'America/Chicago', notes: '' }, clock));
    const other = n.contractors.at(-1)!.id;
    n = must(createPilot(n, other, { ...defaultPilotInput(TODAY), name: 'Other pilot', communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    const op = n.pilots.at(-1)!.id;
    n = must(setPilotStatus(n, op, 'active', clock));
    n = importRows(n, op, [row()]);
    expect(rec(n, 'Alex Rivera', op).eligibility.status).toBe('pending_review');
  });
});

describe('contractor and pilot setup', () => {
  it('validates contractor and pilot fields and activation requirements', () => {
    const s = emptyState();
    expect(createContractor(s, { businessName: 'X', primaryContact: 'Y', email: '', phone: '', timeZone: 'Mars/Base', notes: '' }, clock).ok).toBe(false);
    const c = must(createContractor(s, { businessName: 'X', primaryContact: 'Y', email: '', phone: '', timeZone: 'America/Chicago', notes: '' }, clock));
    const cid = c.contractors[0]!.id;
    expect(createPilot(c, cid, { ...defaultPilotInput(TODAY), name: 'P', endDate: '2026-01-01' }, clock).ok).toBe(false);
    const p = must(createPilot(c, cid, { ...defaultPilotInput(TODAY), name: 'P', endDate: '2026-12-31', approvedChannels: [] }, clock));
    const pid = p.pilots[0]!.id;
    const r = setPilotStatus(p, pid, 'active', clock);
    expect(!r.ok && r.error).toMatch(/Approve at least one/);
    expect(setPilotStatus(p, pid, 'completed', clock).ok).toBe(false);
  });

  it('withdrawing a channel immediately blocks open drafts on it', () => {
    const { s, pilotId } = fixture();
    let n = importRows(s, pilotId, [row()]);
    n = eligible(n, 'Alex Rivera');
    n = must(prepareDraft(n, rec(n, 'Alex Rivera').id, clock));
    const t = openTouch(rec(n, 'Alex Rivera'))!;
    n = must(submitForApproval(n, [t.id], clock));
    n = must(updatePilot(n, pilotId, { ...defaultPilotInput(TODAY), name: 'P', approvedChannels: ['phone'], communicationPolicy: 'x', endDate: '2026-12-31' }, clock));
    expect(rec(n, 'Alex Rivera').touches[0]!.status).toBe('blocked');
    const r = approveDrafts(n, [t.id], clock);
    expect(r.ok && r.batch?.done).toEqual([]);
  });
});
