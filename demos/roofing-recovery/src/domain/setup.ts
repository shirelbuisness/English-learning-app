import { isIsoDate } from './dates.ts';
import { fail, transact } from './state.ts';
import {
  CHANNELS,
  EMAIL_FIRST_SEQUENCE,
  PILOT_STATUS_LABELS,
  type Channel,
  type Clock,
  type Contractor,
  type Pilot,
  type PilotStatus,
  type Result,
  type SequenceStep,
  type WorkbenchState,
} from './types.ts';
import { blockOpenTouches } from './records.ts';

export type ContractorInput = Pick<Contractor, 'businessName' | 'primaryContact' | 'email' | 'phone' | 'timeZone' | 'notes'>;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function checkContractor(input: ContractorInput): void {
  if (!input.businessName.trim()) fail('Business name is required.');
  if (!input.primaryContact.trim()) fail('Primary contact is required.');
  if (!validTimeZone(input.timeZone)) fail(`"${input.timeZone}" is not a recognised time zone (e.g. America/Chicago).`);
}

export function createContractor(state: WorkbenchState, input: ContractorInput, clock: Clock, isDemo = false): Result {
  return transact(state, clock, (tx) => {
    checkContractor(input);
    const id = tx.id('con');
    tx.s.contractors.push({ ...input, businessName: input.businessName.trim(), id, isDemo, createdAt: clock.now });
    tx.log({ type: 'contractor_created', contractorId: id, detail: input.businessName.trim() });
    return `Contractor "${input.businessName.trim()}" created.`;
  });
}

export function updateContractor(state: WorkbenchState, contractorId: string, input: ContractorInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const c = tx.s.contractors.find((x) => x.id === contractorId) ?? fail('Contractor not found.');
    checkContractor(input);
    Object.assign(c, input);
    tx.log({ type: 'contractor_updated', contractorId, detail: input.businessName });
    return 'Contractor updated.';
  });
}

export type PilotInput = Pick<
  Pilot,
  | 'name'
  | 'startDate'
  | 'endDate'
  | 'recordLimit'
  | 'approvedChannels'
  | 'communicationPolicy'
  | 'contactMode'
  | 'contractorAttestation'
  | 'sequence'
  | 'notes'
  | 'hourlyCost'
  | 'revenue'
>;

export function defaultPilotInput(today: string): PilotInput {
  return {
    name: '',
    startDate: today,
    endDate: today,
    recordLimit: 40,
    approvedChannels: ['email'],
    communicationPolicy: '',
    contactMode: 'contractor_system',
    contractorAttestation: null,
    sequence: EMAIL_FIRST_SEQUENCE.map((s) => ({ ...s })),
    notes: '',
    hourlyCost: 45,
    revenue: 0,
  };
}

function checkPilot(input: PilotInput): void {
  if (!input.name.trim()) fail('Pilot name is required.');
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) fail('Start and end dates must be valid dates.');
  if (input.endDate < input.startDate) fail('End date is before start date.');
  if (!Number.isInteger(input.recordLimit) || input.recordLimit < 1 || input.recordLimit > 1000) fail('Record limit must be a whole number from 1 to 1,000.');
  if (input.approvedChannels.some((c) => !CHANNELS.includes(c))) fail('Unknown channel.');
  if (!(input.hourlyCost >= 0) || !(input.revenue >= 0)) fail('Hourly cost and revenue must be zero or more.');
  if (input.contactMode !== 'contractor_system' && input.contactMode !== 'in_workbench') fail('Choose where contact details are kept.');
  if (input.contractorAttestation) {
    if (input.contractorAttestation.text.trim().length < 20) fail('Describe what the contractor confirmed (at least 20 characters).');
    if (!isIsoDate(input.contractorAttestation.recordedOn)) fail('Enter the date the contractor confirmed.');
  }
  checkSequence(input.sequence);
}

function checkSequence(seq: SequenceStep[]): void {
  if (seq.length < 1 || seq.length > 5) fail('The sequence needs 1 to 5 steps.');
  seq.forEach((s, i) => {
    if (s.step !== i + 1) fail('Sequence steps must be numbered 1, 2, 3 …');
    if (!Number.isInteger(s.day) || s.day < 1 || s.day > 60) fail(`Step ${s.step}: day must be from 1 to 60.`);
    if (i > 0 && s.day <= (seq[i - 1]?.day ?? 0)) fail(`Step ${s.step}: day must be after the previous step.`);
  });
  if (seq[0]?.day !== 1) fail('The first step must be on day 1.');
}

export function createPilot(state: WorkbenchState, contractorId: string, input: PilotInput, clock: Clock, isDemo = false): Result {
  return transact(state, clock, (tx) => {
    const contractor = tx.s.contractors.find((c) => c.id === contractorId) ?? fail('Choose a contractor first.');
    checkPilot(input);
    // Pilots under a demo contractor are demo data too, so "Reset demo data" owns them.
    isDemo = isDemo || contractor.isDemo;
    const id = tx.id('pil');
    tx.s.pilots.push({
      ...input,
      name: input.name.trim(),
      approvedChannels: [...new Set(input.approvedChannels)],
      sequence: input.sequence.map((s) => ({ ...s })),
      id,
      contractorId,
      status: 'setup',
      isDemo,
      createdAt: clock.now,
    });
    tx.log({ type: 'pilot_created', contractorId, pilotId: id, detail: input.name.trim() });
    return `Pilot "${input.name.trim()}" created.`;
  });
}

export function updatePilot(state: WorkbenchState, pilotId: string, input: PilotInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const p = tx.s.pilots.find((x) => x.id === pilotId) ?? fail('Pilot not found.');
    checkPilot(input);
    const count = tx.s.records.filter((r) => r.pilotId === pilotId).length;
    if (input.recordLimit < count) fail(`The pilot already has ${count} records; the limit cannot be lower.`);
    if (p.status === 'active' && input.approvedChannels.length === 0) fail('An active pilot needs at least one approved channel.');
    const removed = p.approvedChannels.filter((c) => !input.approvedChannels.includes(c));
    Object.assign(p, { ...input, approvedChannels: [...new Set(input.approvedChannels)], sequence: input.sequence.map((s) => ({ ...s })) });
    // Channel approval withdrawn → open drafts/approvals on that channel are blocked immediately.
    if (removed.length > 0) {
      for (const r of tx.s.records.filter((x) => x.pilotId === pilotId)) {
        blockOpenTouches(tx, r, `Channel approval withdrawn (${removed.join(', ')})`, (t) => removed.includes(t.channel));
      }
    }
    tx.log({ type: 'pilot_updated', contractorId: p.contractorId, pilotId, detail: removed.length ? `Channels withdrawn: ${removed.join(', ')}` : 'Pilot settings updated' });
    return 'Pilot updated.';
  });
}

const PILOT_TRANSITIONS: Record<PilotStatus, PilotStatus[]> = {
  setup: ['active'],
  active: ['paused', 'completed'],
  paused: ['active', 'completed'],
  completed: [],
};

export function setPilotStatus(state: WorkbenchState, pilotId: string, status: PilotStatus, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const p = tx.s.pilots.find((x) => x.id === pilotId) ?? fail('Pilot not found.');
    if (!PILOT_TRANSITIONS[p.status].includes(status)) {
      fail(`A ${PILOT_STATUS_LABELS[p.status].toLowerCase()} pilot cannot be set to ${PILOT_STATUS_LABELS[status].toLowerCase()}.`);
    }
    if (status === 'active') {
      if (p.approvedChannels.length === 0) fail('Approve at least one communication channel before activating.');
      if (!p.communicationPolicy.trim()) fail('Record the approved communication policy before activating.');
      if (p.contactMode === 'contractor_system' && !p.contractorAttestation) {
        fail("Record the contractor's confirmation that these homeowners may be contacted before activating a privacy-safe pilot.");
      }
    }
    tx.log({ type: 'pilot_status_changed', contractorId: p.contractorId, pilotId, from: p.status, to: status, detail: `Pilot ${status}` });
    p.status = status;
    return `Pilot is now ${PILOT_STATUS_LABELS[status].toLowerCase()}.`;
  });
}

export type { Channel };
