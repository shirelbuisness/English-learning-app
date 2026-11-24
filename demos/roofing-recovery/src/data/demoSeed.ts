import { toCsv } from '../domain/csv.ts';
import { addDays, clockAt } from '../domain/dates.ts';
import { addExpense, addTimeEntry } from '../domain/economics.ts';
import { commitImport, TEMPLATE_COLUMNS } from '../domain/importer.ts';
import { stripDemo } from '../domain/lifecycle.ts';
import {
  acknowledgeHandoff,
  approveDrafts,
  confirmContact,
  createHandoff,
  editDraft,
  excludeRecord,
  markHandoffNotified,
  openTouch,
  prepareDraft,
  qualifyReengagement,
  recordHandoffOutcome,
  recordResponse,
  setEligibility,
  submitForApproval,
  suppressRecord,
} from '../domain/records.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus } from '../domain/setup.ts';
import type { Clock, IsoDate, Outcome, Result, WorkbenchState } from '../domain/types.ts';

/*
 * Synthetic demonstration data. Every name, email (example.com) and phone
 * number (555-01xx) is fictional. The demo is built by running the same
 * domain commands the operator uses, back-dated relative to today, so its
 * history and figures are internally consistent.
 */

type Row = [
  name: string,
  email: string,
  phone: string,
  ageAtImport: number | string,
  amount: string,
  service: string,
  city: string,
  status: string,
  lastContactDaysBeforeImport: number | '',
  followUps: string,
  source: string,
  emailConsent: string,
  phoneConsent: string,
  smsConsent: string,
  evidence: string,
  prefs: string,
  optOut: string,
  exclude: string,
];

const FORM = 'Consent checkbox on estimate request form';

const MAIN_ROWS: Row[] = [
  ['Maria Delgado', 'maria.delgado@example.com', '(512) 555-0101', 20, '18400', 'Hail damage roof replacement', 'Round Rock', 'open', 18, '0', 'Website form', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['James Whitfield', 'James.Whitfield@Example.com', '512-555-0102', 22, '$22,750', 'Full roof replacement (architectural shingle)', 'Cedar Park', 'open', 20, '0', 'Angi', 'yes', 'yes', 'unknown', 'Angi lead terms + verbal consent on inspection call', '', 'no', 'no'],
  ['Robert Castillo', 'rcastillo@example.com', '5125550103', 35, '31200', 'Standing-seam metal roof', 'Georgetown', 'open', 30, '2', 'Referral', 'yes', 'yes', 'no', 'Signed estimate acknowledgement with contact consent', 'Calls after 5pm', 'no', 'no'],
  ['Patricia Nguyen', 'p.nguyen@example.com', '(512)555-0104', 16, '9600', 'Partial roof replacement (storm damage)', 'Austin', 'open', 15, '1', 'Google Business Profile', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Marcus Johnson', 'marcus.j@example.com', '254-555-0105', 25, '19800', 'Hail damage roof replacement', 'Waco', 'open', 24, '0', 'Angi', 'yes', 'yes', 'unknown', 'Angi lead terms + verbal consent on inspection call', '', 'no', 'no'],
  ['Linda Okafor', 'linda.okafor@example.com', '512-555-0106', 18, '12900', 'Roof replacement with ridge vent', 'Pflugerville', 'open', 17, '0', 'Facebook', 'yes', 'no', 'no', FORM, 'Email only', 'no', 'no'],
  ['Kevin Brandt', 'kevin.brandt@example.com', '512-555-0107', 40, '4800', 'Leak repair and decking replacement', 'Leander', 'open', 38, '1', 'Website form', 'yes', 'no', 'no', FORM, 'Email only', 'no', 'no'],
  ['Angela Ruiz', 'angela.ruiz@example.com', '512-555-0108', 28, '16900', 'Full roof replacement', 'Kyle', 'open', 27, '0', 'Google Business Profile', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Thomas Harper', 'tharper@example.com', '512-555-0109', 55, '14200', 'Roof replacement', 'San Marcos', 'open', 50, '3', 'Angi', 'yes', 'yes', 'unknown', 'Angi lead terms', '', 'no', 'no'],
  ['Chris Patel', 'chris.patel@example.com', '512-555-0110', 24, '7300', 'Gutter and fascia replacement', 'Dripping Springs', 'open', 22, '0', 'Google Business Profile', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Stephanie Brooks', 's.brooks@example.com', '210-555-0111', 30, '17300', 'Full roof replacement', 'San Antonio', 'open', 29, '1', 'Website form', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Gary Whitman', 'gary.whitman@example.com', '512-555-0112', 33, '10400', 'Roof replacement', 'Round Rock', 'open', 31, '1', 'Website form', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Teresa Flores', 'teresa.flores@example.com', '512-555-0113', 19, '26500', 'Concrete tile roof repair', 'Austin', 'open', 18, '0', 'Referral', 'yes', 'yes', 'unknown', 'Signed estimate acknowledgement with contact consent', '', 'no', 'no'],
  ['Daniel Kim', 'daniel.kim@example.com', '512-555-0114', 21, '15600', 'Full roof replacement', 'Buda', 'open', 20, '0', 'Website form', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Rachel Moreno', 'rachel.moreno@example.com', '512-555-0115', 26, '8900', 'Partial roof replacement', 'Hutto', 'open', 25, '1', 'Facebook', 'yes', 'unknown', 'unknown', FORM, '', 'no', 'no'],
  ['Brian Foster', 'brian.foster@example.com', '512-555-0116', 45, '21400', 'Metal roof installation', 'Bastrop', 'open', 40, '2', 'Referral', 'yes', 'yes', 'unknown', 'Signed estimate acknowledgement with contact consent', '', 'no', 'no'],
  ['Olivia Grant', 'olivia.grant@example.com', '512-555-0117', 17, '11800', 'Roof replacement', 'Lakeway', 'open', 16, '0', 'Website form', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Samuel Ortiz', 'samuel.ortiz@example.com', '512-555-0118', 23, '13400', 'Storm damage repair', 'Kyle', 'open', 21, '0', 'Google Business Profile', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
  ['Hannah Lee', 'hannah.lee@example.com', '512-555-0119', 29, '6200', 'Skylight and flashing repair', 'Austin', 'open', 27, '0', 'Website form', 'yes', 'unknown', 'unknown', FORM, '', 'no', 'no'],
  ['Victor Ramos', 'victor.ramos@example.com', '512-555-0120', 38, '18900', 'Full roof replacement', 'Georgetown', 'open', 35, '1', 'Yard sign', 'yes', 'yes', 'unknown', 'Verbal consent noted by office manager on intake call', '', 'no', 'no'],
  // Records that need review or are restricted.
  ['Jennifer Alvarez', 'jen.alvarez@example.com', '830-555-0121', 27, '15200', 'Full roof replacement', 'New Braunfels', 'open', 25, '0', 'Website form', '', '', '', '', '', 'no', 'no'],
  ['David Sutherland', '', '', 31, '14200', 'Roof replacement', 'Bastrop', 'open', 30, '1', 'Phone call', '', '', '', '', '', 'no', 'no'],
  ['Michelle Carter', 'michelle.carter@example', '(512) 555-012', 24, '9800', 'Leak repair', 'Austin', 'open', 22, '0', 'Website form', 'yes', 'yes', '', FORM, '', 'no', 'no'],
  ['Paul Nguyen', 'paul.nguyen@example.com', '512-555-0124', 20, '', 'Roof inspection', 'Austin', 'open', 18, '0', 'Website form', 'yes', '', '', FORM, '', 'no', 'no'],
  ['Sarah Mitchell', 'sarah.mitchell@example.com', '512-555-0125', 32, '12400', 'Roof replacement', 'Cedar Park', 'pending?', 30, '1', 'Website form', 'yes', 'yes', '', FORM, '', 'no', 'no'],
  ['Eric Johansson', 'eric.j@example.com', '512-555-0126', 22, '16000', 'Full roof replacement', 'Round Rock', 'open', 20, '2', 'Angi', 'yes', 'yes', '', 'Angi lead terms', '', 'yes', 'no'],
  ['Laura Bennett', 'laura.bennett@example.com', '512-555-0127', 26, '8700', 'Gutter replacement', 'Leander', 'open', 24, '0', 'Referral', 'yes', 'yes', '', FORM, '', 'no', 'yes'],
  ["Michael O'Brien", 'mobrien@example.com', '512-555-0128', 30, '38500', 'Concrete tile roof replacement', 'Lakeway', 'sold', 10, '1', 'Referral', 'yes', 'yes', '', 'Signed contract', '', 'no', 'no'],
  ['Karen White', 'karen.white@example.com', '512-555-0129', 8, '9900', 'Roof replacement', 'Austin', 'open', 7, '0', 'Website form', 'yes', 'yes', '', FORM, '', 'no', 'no'],
  ['George Hall', 'george.hall@example.com', '512-555-0130', 75, '11200', 'Roof replacement', 'Temple', 'open', 70, '1', 'Yard sign', 'yes', 'yes', '', 'Verbal consent noted by office manager on intake call', '', 'no', 'no'],
  ['Maria Delgado', 'MARIA.DELGADO@example.com', '512.555.0101', 20, '18400', 'Hail damage roof replacement', 'Round Rock', 'open', 18, '0', 'Website form', 'yes', 'yes', '', FORM, '', 'no', 'no'],
  ['Victor Lin', 'victor.lin@example.com', '512-555-0132', '10/12/2026', '9100', 'Leak repair', 'Austin', 'open', '', '0', 'Website form', 'yes', '', '', FORM, '', 'no', 'no'],
  ['Natalie Price', 'natalie.price@example.com', '512-555-0133', 36, '7600', 'Roof repair', 'Kyle', 'open', 33, '0', 'Facebook', 'maybe', '', '', FORM, '', 'no', 'no'],
];

function rowsToCsv(rows: Row[], importDate: IsoDate): string {
  return toCsv(
    TEMPLATE_COLUMNS,
    rows.map((r) => {
      const [name, email, phone, age, amount, service, city, status, last, fu, source, ec, pc, sc, ev, prefs, opt, exc] = r;
      const estimateDate = typeof age === 'number' ? addDays(importDate, -age) : age;
      const lastContact = last === '' ? '' : addDays(importDate, -last);
      return [name, email, phone, estimateDate, amount, service, city, 'TX', status, lastContact, fu, source, source === 'Referral' ? 'Referral introduction' : `${source} lead`, ec, pc, sc, ev, prefs, opt, exc];
    }),
  );
}

export const DEMO_PILOT_NAME = 'Pilot 1 — Unsold estimates (demo)';

/** Rebuild the demo on top of any non-demo data. */
export function withDemoData(base: WorkbenchState, today: IsoDate): WorkbenchState {
  let s = stripDemo(base);
  const day = (offset: number): Clock => clockAt(addDays(today, offset));
  const act = (r: Result | { ok: true; state: WorkbenchState } | { ok: false; error: string }) => {
    if (!r.ok) throw new Error(`Demo seed failed: ${r.error}`);
    s = r.state;
  };

  // Contractor and pilot.
  act(createContractor(s, { businessName: 'Hill Country Roofing (demo)', primaryContact: 'Dale Mercer', email: 'office@hillcountry-roofing.example.com', phone: '(512) 555-0142', timeZone: 'America/Chicago', notes: 'Fictional demonstration contractor. Owner-operator, 2 crews, Central Texas.' }, day(-16), true));
  const hc = s.contractors.at(-1)!.id;
  act(createPilot(s, hc, {
    ...defaultPilotInput(today),
    name: DEMO_PILOT_NAME,
    startDate: addDays(today, -14),
    endDate: addDays(today, 16),
    recordLimit: 40,
    approvedChannels: ['email', 'phone'],
    communicationPolicy:
      'Contractor-approved: email (Day 1, Day 9) and phone (Day 4) only to homeowners who requested an estimate and gave documented consent. ' +
      'Every message approved by Dale before contact. No text messages. Stop immediately on any opt-out request.',
    notes: 'Synthetic demonstration pilot.',
    hourlyCost: 45,
    revenue: 1500,
  }, day(-16)));
  const pilot = s.pilots.at(-1)!.id;
  const id = (name: string) => s.records.find((r) => r.pilotId === pilot && r.customerName === name)!.id;
  const touchOf = (name: string) => openTouch(s.records.find((r) => r.id === id(name))!)!.id;

  // Imports.
  act(commitImport(s, pilot, rowsToCsv(MAIN_ROWS, addDays(today, -14)), 'hill-country-unsold-estimates.csv', {}, day(-14)));
  const update: Row[] = [
    MAIN_ROWS[1]!,
    ['Chris Patel', 'chris.patel@example.com', '512-555-0110', 24, '7900', 'Gutter and fascia replacement', 'Dripping Springs', 'open', 22, '0', 'Google Business Profile', 'yes', 'yes', 'unknown', FORM, '', 'no', 'no'],
    ['Angela Ruiz', 'angela.ruiz@example.com', '512-555-0118', 28, '16900', 'Full roof replacement', 'Kyle', 'open', 27, '0', 'Google Business Profile', 'yes', 'yes', '', FORM, '', 'no', 'no'],
    ['Nora Diaz', 'nora.diaz@example.com', '512-555-0134', 15, '14800', 'Full roof replacement', 'Pflugerville', 'open', 14, '0', 'Website form', 'yes', 'yes', '', FORM, '', 'no', 'no'],
  ];
  const updateCsv = rowsToCsv(update, addDays(today, -14));
  act(commitImport(s, pilot, updateCsv, 'contractor-additions.csv', { 3: 'update' }, day(-13)));

  act(setPilotStatus(s, pilot, 'active', day(-13)));

  // Eligibility review.
  const eligible = ['Maria Delgado', 'James Whitfield', 'Robert Castillo', 'Patricia Nguyen', 'Marcus Johnson', 'Linda Okafor', 'Kevin Brandt', 'Angela Ruiz', 'Thomas Harper', 'Chris Patel', 'Stephanie Brooks', 'Gary Whitman', 'Teresa Flores', 'Daniel Kim', 'Rachel Moreno', 'Brian Foster', 'Olivia Grant', 'Samuel Ortiz', 'Hannah Lee', 'Victor Ramos', 'Karen White', 'George Hall', 'Nora Diaz'];
  for (const n of eligible) act(setEligibility(s, id(n), 'eligible', '', day(-13)));

  // Day 1 emails.
  const wave = ['Maria Delgado', 'James Whitfield', 'Robert Castillo', 'Patricia Nguyen', 'Marcus Johnson', 'Linda Okafor', 'Angela Ruiz', 'Stephanie Brooks', 'Teresa Flores', 'Daniel Kim', 'Gary Whitman', 'Chris Patel'];
  for (const n of wave) act(prepareDraft(s, id(n), day(-12)));
  const james = s.records.find((r) => r.id === id('James Whitfield'))!;
  act(editDraft(s, touchOf('James Whitfield'), openTouch(james)!.draft.replace('Is the project still', 'You mentioned impact-resistant shingles — happy to price that option too. Is the project still'), day(-12)));
  act(submitForApproval(s, wave.map(touchOf), day(-12)));
  act(approveDrafts(s, wave.map(touchOf), day(-11)));

  const contact = (name: string, outcome: Outcome, on: number, notes = '') => {
    const t = s.records.find((r) => r.id === id(name))!.touches.find((x) => x.status === 'approved')!;
    act(confirmContact(s, t.id, { confirmed: true, contactedOn: addDays(today, on), channel: t.channel, outcome, notes }, day(on)));
  };
  contact('Maria Delgado', 'interested', -10, 'Replied: still needs the roof done, wants someone to re-check the hail damage.');
  contact('James Whitfield', 'no_response', -10);
  contact('Robert Castillo', 'no_response', -10);
  contact('Patricia Nguyen', 'callback', -10, 'Asked for a call about financing options.');
  contact('Marcus Johnson', 'no_response', -10);
  contact('Linda Okafor', 'opted_out', -10, 'Replied "please remove me from your list".');
  contact('Angela Ruiz', 'no_response', -10);
  contact('Stephanie Brooks', 'not_interested', -10, 'Went with another roofer.');
  contact('Teresa Flores', 'revised_estimate', -10, 'Asked whether the repair could be phased over two years.');
  contact('Daniel Kim', 'no_response', -10);
  contact('Gary Whitman', 'wrong_contact', -10, 'Email bounced: address does not exist.');
  contact('Chris Patel', 'no_response', -10);

  const prep = (name: string, d: number) => act(prepareDraft(s, id(name), day(d)));
  const submit = (name: string, d: number) => act(submitForApproval(s, [touchOf(name)], day(d)));
  const approve = (name: string, d: number) => act(approveDrafts(s, [touchOf(name)], day(d)));
  const qualify = (name: string, d: number, request: 'inspection' | 'callback', notes: string) =>
    act(qualifyReengagement(s, id(name), { confirmed: true, request, notes }, day(d)));

  // From here on, strictly in date order (the audit log is chronological).
  // Day -9: replies reviewed.
  qualify('Maria Delgado', -9, 'inspection', 'Project unresolved; asked for a re-inspection.');
  act(createHandoff(s, id('Maria Delgado'), { respondedOn: addDays(today, -10), homeownerRequest: 'Re-inspection of hail damage before deciding', conversationNotes: 'Insurance claim still open. Prefers weekday mornings.', nextAction: 'Dale to call and book re-inspection' }, day(-9)));
  act(markHandoffNotified(s, id('Maria Delgado'), addDays(today, -9), day(-9)));
  qualify('Patricia Nguyen', -9, 'callback', 'Wants to discuss financing; project still open.');

  // Day -8.
  act(acknowledgeHandoff(s, id('Maria Delgado'), addDays(today, -8), 'Dale will call Thursday.', day(-8)));
  act(createHandoff(s, id('Patricia Nguyen'), { respondedOn: addDays(today, -10), homeownerRequest: 'Callback about financing options', conversationNotes: 'Available after 4pm.', nextAction: 'Office to call with financing options' }, day(-8)));
  act(markHandoffNotified(s, id('Patricia Nguyen'), addDays(today, -8), day(-8)));
  for (const n of ['James Whitfield', 'Robert Castillo']) {
    prep(n, -8);
    submit(n, -8);
  }

  // Day -7: Day 4 calls.
  for (const n of ['James Whitfield', 'Robert Castillo']) {
    approve(n, -7);
    contact(n, 'no_response', -7);
  }
  prep('Marcus Johnson', -7);
  submit('Marcus Johnson', -7); // still awaiting contractor approval
  prep('Angela Ruiz', -7);
  submit('Angela Ruiz', -7);

  // Day -6 to -4.
  approve('Angela Ruiz', -6); // approved and due, not yet contacted
  act(recordHandoffOutcome(s, id('Maria Delgado'), { outcome: 'appointment_reported', date: addDays(today, -5), notes: 'Contractor reports re-inspection booked.', verifiedByContractor: false, jobValue: null }, day(-5)));
  act(recordResponse(s, id('Daniel Kim'), { outcome: 'inspection', date: addDays(today, -4), channel: 'email', notes: 'Replied late: wants an inspection before hurricane season.' }, day(-4)));

  // Day -3.
  qualify('Daniel Kim', -3, 'inspection', 'Project unresolved; inspection requested.');
  act(createHandoff(s, id('Daniel Kim'), { respondedOn: addDays(today, -4), homeownerRequest: 'Inspection before deciding', conversationNotes: 'Flexible schedule.', nextAction: 'Book inspection' }, day(-3)));
  for (const n of ['James Whitfield', 'Olivia Grant']) {
    prep(n, -3);
    submit(n, -3);
  }

  // Day -2.
  approve('James Whitfield', -2); // Day 9 approved, due now
  approve('Olivia Grant', -2);
  prep('Robert Castillo', -2); // Day 9 draft prepared, not yet submitted
  prep('Samuel Ortiz', -2);
  submit('Samuel Ortiz', -2);
  act(markHandoffNotified(s, id('Daniel Kim'), addDays(today, -2), day(-2)));

  // Day -1: restrictions override approved and submitted drafts.
  act(suppressRecord(s, id('Olivia Grant'), { reason: 'Homeowner called the office and asked not to be contacted', channel: 'phone', date: addDays(today, -1), source: 'homeowner' }, day(-1)));
  act(excludeRecord(s, id('Samuel Ortiz'), 'Family friend — Dale will follow up personally', day(-1)));
  act(acknowledgeHandoff(s, id('Daniel Kim'), addDays(today, -1), 'Crew lead will schedule.', day(-1)));

  // Day -1: a second contractor with a pilot still in setup (shows pilot isolation).
  act(createContractor(s, { businessName: 'Gulf Coast Exteriors (demo)', primaryContact: 'Ana Villarreal', email: 'ana@gulfcoast-exteriors.example.com', phone: '(361) 555-0177', timeZone: 'America/Chicago', notes: 'Fictional demonstration contractor. Onboarding.' }, day(-1), true));
  const gc = s.contractors.at(-1)!.id;
  act(createPilot(s, gc, { ...defaultPilotInput(today), name: 'Pilot 1 — Gulf Coast (demo, setup)', startDate: addDays(today, 3), endDate: addDays(today, 33), recordLimit: 30, notes: 'Waiting for signed pilot terms.' }, day(-1)));
  const gcPilot = s.pilots.at(-1)!.id;
  const gcRows: Row[] = [
    ['Luis Herrera', 'luis.herrera@example.com', '361-555-0201', 25, '16700', 'Hurricane strap retrofit and re-roof', 'Corpus Christi', 'open', 22, '0', 'Website form', 'yes', 'unknown', '', FORM, '', 'no', 'no'],
    ['Amy Collins', 'amy.collins@example.com', '361-555-0202', 33, '9800', 'Leak repair', 'Portland', 'open', 30, '1', 'Google Business Profile', 'unknown', 'unknown', '', '', '', 'no', 'no'],
    ['Ben Wallace', 'ben.wallace@example.com', '361-555-0203', 41, '21900', 'Metal roof installation', 'Rockport', 'open', 38, '0', 'Referral', 'yes', 'yes', '', 'Signed estimate acknowledgement', '', 'no', 'no'],
    ['Linda Okafor', 'linda.okafor@example.com', '361-555-0204', 20, '7400', 'Gutter replacement', 'Aransas Pass', 'open', 18, '0', 'Facebook', 'yes', '', '', FORM, '', 'no', 'no'],
  ];
  act(commitImport(s, gcPilot, rowsToCsv(gcRows, addDays(today, -1)), 'gulf-coast-estimates.csv', {}, day(-1)));

  // Today: operator time sheet entered for the work days (synthetic).
  const time = [
    ['onboarding', 90, -15, 'measured', 'Kickoff call, pilot terms, policy'],
    ['data_cleanup', 75, -14, 'measured', 'Fixing export columns, consent fields'],
    ['eligibility_review', 60, -13, 'measured', '23 records reviewed'],
    ['draft_preparation', 80, -12, 'measured', 'Day 1 drafts, 12 records'],
    ['outreach', 45, -10, 'measured', 'Day 1 emails'],
    ['reply_handling', 35, -9, 'measured', ''],
    ['handoffs', 25, -8, 'measured', ''],
    ['outreach', 40, -7, 'measured', 'Day 4 calls'],
    ['draft_preparation', 30, -3, 'measured', ''],
    ['reporting', 20, -2, 'estimated', 'Reconstructed afterwards'],
  ] as const;
  for (const [category, minutes, d, basis, notes] of time) {
    act(addTimeEntry(s, pilot, { category, minutes, date: addDays(today, d), basis, notes }, day(0)));
  }
  act(addExpense(s, pilot, { description: 'Pilot phone line (1 month)', amount: 15, date: addDays(today, -14) }, day(0)));
  act(addTimeEntry(s, gcPilot, { category: 'onboarding', minutes: 45, date: addDays(today, -1), basis: 'measured', notes: 'Intro call' }, day(0)));

  return s;
}
