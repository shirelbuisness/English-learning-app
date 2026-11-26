import { toCsv } from '../domain/csv.ts';
import { addDays, clockAt } from '../domain/dates.ts';
import { addTimeEntry } from '../domain/economics.ts';
import { commitImport } from '../domain/importer.ts';
import { stripDemo } from '../domain/lifecycle.ts';
import {
  confirmContact,
  approveDrafts,
  excludeRecord,
  openTouch,
  prepareDraft,
  recordResponse,
  setEligibility,
  submitForApproval,
} from '../domain/records.ts';
import { createContractor, createPilot, defaultPilotInput, setPilotStatus } from '../domain/setup.ts';
import type { Channel, Clock, IsoDate, Result, WorkbenchState } from '../domain/types.ts';

/*
 * The 3-minute demo: one privacy-safe Founding Partner Pilot with 10 fictional
 * residential roofing estimates. Only estimate ID, first name, scope, quote,
 * age and notes are stored: no phone numbers, emails or street addresses.
 * Built by running the real domain commands, back-dated relative to today.
 */

export const SAMPLE_CONTRACTOR = 'Lone Star Roofing & Exteriors (sample)';
export const SAMPLE_PILOT = 'Founding Partner Pilot (sample)';

/** [Estimate ID, First Name, Roof Scope, Quote Amount, Days Since Sent (as of today), Notes] */
export const SAMPLE_ESTIMATES: [string, string, string, string, number, string][] = [
  ['Q-2231', 'Sarah', 'Full replacement, architectural shingles', '$18,400', 21, 'Waiting on adjuster'],
  ['Q-2236', 'Mike', 'Full replacement + standing-seam metal accent over porch', '$22,000', 30, 'Getting 2nd bid'],
  ['Q-2240', 'Linda', 'Hail claim, full replacement, architectural shingles', '$14,900', 16, 'Husband/wife deciding'],
  ['Q-2244', 'David', 'Full replacement, architectural shingles', '$11,200', 35, 'Asked about financing, budget is tight'],
  ['Q-2247', 'Maria', 'Wind damage claim, partial re-roof + new gutters', '$9,500', 23, 'Adjuster approved, waiting on first check'],
  ['Q-2251', 'James', 'Full replacement, architectural shingles + ridge vent', '$16,750', 48, 'Said to circle back after the holidays'],
  ['Q-2255', 'Karen', 'Full replacement + metal accent over bay window', '$19,800', 14, 'Getting 2nd bid'],
  ['Q-2258', 'Robert', 'Hail claim, full replacement', '$21,300', 41, 'Waiting on adjuster re-inspection'],
  ['Q-2262', 'Angela', 'Full replacement, architectural shingles', '$12,600', 27, 'Husband/wife deciding'],
  ['Q-2266', 'Tom', 'Full replacement', '$13,900', 32, "Owner's neighbor — skip"],
];

export function sampleCsv(importOffset: number): string {
  return toCsv(
    ['Estimate ID', 'First Name', 'Roof Scope', 'Quote Amount', 'Days Since Sent', 'Notes'],
    SAMPLE_ESTIMATES.map(([id, name, scope, amount, days, notes]) => [id, name, scope, amount, String(days + importOffset), notes]),
  );
}

/** Replace any demo data with the sample pipeline. Non-demo pilots are untouched. */
export function withSamplePipeline(base: WorkbenchState, today: IsoDate): WorkbenchState {
  let s = stripDemo(base);
  const day = (offset: number): Clock => clockAt(addDays(today, offset));
  const act = (r: Result | { ok: true; state: WorkbenchState } | { ok: false; error: string }) => {
    if (!r.ok) throw new Error(`Sample pipeline failed: ${r.error}`);
    s = r.state;
  };

  act(createContractor(s, { businessName: SAMPLE_CONTRACTOR, primaryContact: 'Wade Collins', email: 'office@lonestar-roofing.example.com', phone: '(512) 555-0188', timeZone: 'America/Chicago', notes: 'Fictional sample contractor for demos.' }, day(-4), true));
  const contractorId = s.contractors.at(-1)!.id;
  act(createPilot(s, contractorId, {
    ...defaultPilotInput(today),
    name: SAMPLE_PILOT,
    startDate: addDays(today, -3),
    endDate: addDays(today, 11),
    recordLimit: 25,
    approvedChannels: ['email', 'sms'],
    contactMode: 'contractor_system',
    contractorAttestation: {
      text: 'Wade confirmed every homeowner on the list requested an estimate from Lone Star and may be followed up by email or text about it. Anyone who asked not to be contacted was left off.',
      recordedOn: addDays(today, -4),
    },
    communicationPolicy: 'Every message approved by Wade before it goes out (reply "Approved" by text). Email and text only, sent from Lone Star\'s own inbox and business number. Stop immediately on any opt-out.',
    sequence: [
      { step: 1, day: 1, channel: 'email', template: 'initial' },
      { step: 2, day: 4, channel: 'sms', template: 'unanswered' },
      { step: 3, day: 9, channel: 'email', template: 'final' },
    ],
    notes: 'Sample data only.',
    hourlyCost: 45,
    revenue: 300,
  }, day(-4)));
  const pilotId = s.pilots.at(-1)!.id;
  const id = (ref: string) => s.records.find((r) => r.pilotId === pilotId && r.estimateRef === ref)!.id;
  const touch = (ref: string) => openTouch(s.records.find((r) => r.id === id(ref))!)!.id;

  // Day -3: import, activate, review.
  act(commitImport(s, pilotId, sampleCsv(-3), 'lone-star-stale-quotes.csv', {}, day(-3)));
  act(setPilotStatus(s, pilotId, 'active', day(-3)));
  for (const ref of ['Q-2231', 'Q-2236', 'Q-2240', 'Q-2244', 'Q-2247', 'Q-2251', 'Q-2258', 'Q-2262']) act(setEligibility(s, id(ref), 'eligible', '', day(-3)));
  act(excludeRecord(s, id('Q-2266'), "Owner's neighbor — Wade will handle personally", day(-3)));
  // Q-2255 (Karen) stays in review: shows the review step in the demo.

  // Day -3: first emails for Sarah and Robert, approved by Wade; sent day -2.
  for (const ref of ['Q-2231', 'Q-2258']) act(prepareDraft(s, id(ref), day(-3)));
  act(submitForApproval(s, [touch('Q-2231'), touch('Q-2258')], day(-3)));
  act(approveDrafts(s, [touch('Q-2231'), touch('Q-2258')], day(-3)));
  for (const ref of ['Q-2231', 'Q-2258']) {
    const t = touch(ref);
    act(confirmContact(s, t, { confirmed: true, contactedOn: addDays(today, -2), channel: 'email', outcome: 'no_response', notes: 'Sent from Lone Star inbox' }, day(-2)));
  }

  // Day -1: Sarah replies — the warm lead.
  act(recordResponse(s, id('Q-2231'), {
    outcome: 'callback',
    date: addDays(today, -1),
    channel: 'email',
    notes: 'Yes, still want it done! Adjuster finally approved the claim. Can someone call me about scheduling? Afternoons are best.',
  }, day(-1)));

  // Day -1: four new drafts ready for Wade's approval (email + text variants).
  const drafts: [string, Channel][] = [['Q-2236', 'email'], ['Q-2240', 'sms'], ['Q-2244', 'email'], ['Q-2247', 'sms']];
  for (const [ref, channel] of drafts) act(prepareDraft(s, id(ref), day(-1), channel));

  // Operator time so far (synthetic).
  for (const [category, minutes, d, notes] of [
    ['onboarding', 30, -4, 'Kickoff call with Wade, attestation'],
    ['data_cleanup', 20, -3, 'Cleaned quote export'],
    ['eligibility_review', 15, -3, '10 estimates'],
    ['draft_preparation', 25, -1, '6 drafts'],
    ['outreach', 10, -2, 'Sent 2 emails from Lone Star inbox'],
  ] as const) {
    act(addTimeEntry(s, pilotId, { category, minutes, date: addDays(today, d), basis: 'measured', notes }, day(0)));
  }
  return s;
}
