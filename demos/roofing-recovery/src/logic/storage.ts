import type { Lead } from './types.ts';

const KEY = 'roofing-recovery-demo:v1';
const STATES = new Set(['open', 'approved', 'completed', 'dismissed']);

function looksLikeLead(value: unknown): value is Lead {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Lead>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.estimateValue === 'number' &&
    Array.isArray(v.history) &&
    typeof v.followUp === 'object' &&
    v.followUp !== null &&
    STATES.has(v.followUp.state)
  );
}

/** Load saved demo state; returns null if absent, unreadable or malformed. */
export function loadLeads(storage: Pick<Storage, 'getItem'> | undefined): Lead[] | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const leads = (parsed as { leads?: unknown }).leads;
    return Array.isArray(leads) && leads.every(looksLikeLead) ? leads : null;
  } catch {
    return null;
  }
}

export function saveLeads(storage: Pick<Storage, 'setItem'> | undefined, leads: readonly Lead[]): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ version: 1, leads }));
  } catch {
    // Storage full or blocked: the demo keeps working in memory.
  }
}

export function clearLeads(storage: Pick<Storage, 'removeItem'> | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}
