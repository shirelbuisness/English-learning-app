import { isIsoDate } from './dates.ts';
import { fail, transact } from './state.ts';
import { TIME_CATEGORIES, TIME_CATEGORY_LABELS, type Clock, type Result, type TimeCategory, type WorkbenchState } from './types.ts';

export interface TimeInput {
  category: TimeCategory;
  minutes: number;
  date: string;
  basis: 'measured' | 'estimated';
  notes: string;
}

export function addTimeEntry(state: WorkbenchState, pilotId: string, input: TimeInput, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const pilot = tx.s.pilots.find((p) => p.id === pilotId) ?? fail('Select a pilot.');
    if (!TIME_CATEGORIES.includes(input.category)) fail('Choose an activity category.');
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 24 * 60) fail('Duration must be 1 to 1,440 minutes.');
    if (!isIsoDate(input.date) || input.date > clock.today) fail('Enter a valid date (not in the future).');
    const id = tx.id('tim');
    tx.s.timeEntries.push({ ...input, notes: input.notes.trim(), id, pilotId, createdAt: clock.now });
    tx.log({ type: 'time_logged', pilotId, contractorId: pilot.contractorId, detail: `${input.minutes} min ${TIME_CATEGORY_LABELS[input.category]} (${input.basis})` });
    return `Logged ${input.minutes} minutes.`;
  });
}

export function deleteTimeEntry(state: WorkbenchState, entryId: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const e = tx.s.timeEntries.find((x) => x.id === entryId) ?? fail('Time entry not found.');
    tx.s.timeEntries = tx.s.timeEntries.filter((x) => x.id !== entryId);
    tx.log({ type: 'time_deleted', pilotId: e.pilotId, contractorId: tx.s.pilots.find((p) => p.id === e.pilotId)?.contractorId ?? null, detail: `Removed ${e.minutes} min ${TIME_CATEGORY_LABELS[e.category]} on ${e.date}` });
    return 'Time entry removed.';
  });
}

export function addExpense(state: WorkbenchState, pilotId: string, input: { description: string; amount: number; date: string }, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const pilot = tx.s.pilots.find((p) => p.id === pilotId) ?? fail('Select a pilot.');
    if (!input.description.trim()) fail('Describe the expense.');
    if (!(input.amount > 0) || input.amount > 1_000_000) fail('Amount must be more than zero.');
    if (!isIsoDate(input.date) || input.date > clock.today) fail('Enter a valid date (not in the future).');
    tx.s.expenses.push({ id: tx.id('exp'), pilotId, description: input.description.trim(), amount: Math.round(input.amount * 100) / 100, date: input.date, createdAt: clock.now });
    tx.log({ type: 'expense_added', pilotId, contractorId: pilot.contractorId, detail: `${input.description.trim()}: $${input.amount}` });
    return 'Expense added.';
  });
}

export function deleteExpense(state: WorkbenchState, expenseId: string, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const e = tx.s.expenses.find((x) => x.id === expenseId) ?? fail('Expense not found.');
    tx.s.expenses = tx.s.expenses.filter((x) => x.id !== expenseId);
    tx.log({ type: 'expense_deleted', pilotId: e.pilotId, contractorId: tx.s.pilots.find((p) => p.id === e.pilotId)?.contractorId ?? null, detail: `Removed ${e.description} ($${e.amount})` });
    return 'Expense removed.';
  });
}

export function setPilotEconomics(state: WorkbenchState, pilotId: string, hourlyCost: number, revenue: number, clock: Clock): Result {
  return transact(state, clock, (tx) => {
    const p = tx.s.pilots.find((x) => x.id === pilotId) ?? fail('Pilot not found.');
    if (!(hourlyCost >= 0) || hourlyCost > 1000) fail('Hourly cost must be 0 to 1,000.');
    if (!(revenue >= 0) || revenue > 10_000_000) fail('Revenue must be zero or more.');
    tx.log({ type: 'pilot_economics_updated', pilotId, contractorId: p.contractorId, from: `$${p.hourlyCost}/h, $${p.revenue}`, to: `$${hourlyCost}/h, $${revenue}`, detail: 'Hourly cost assumption / pilot revenue updated' });
    p.hourlyCost = hourlyCost;
    p.revenue = revenue;
    return 'Saved.';
  });
}
