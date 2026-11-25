import type { WorkbenchState } from '../domain/types.ts';

/*
 * Persistence boundary. The rest of the app only sees `load` and `save`.
 * This implementation uses browser localStorage: unencrypted, per-browser,
 * not suitable for real customer data. A database-backed store can replace it
 * behind the same functions.
 */

export type SaveResult = { ok: true; revision: number } | { ok: false; reason: 'conflict' | 'unavailable' };

export interface WorkbenchStore {
  /** `error` is set when saved data existed but could not be read; it is backed up, not discarded. */
  load(): { state: WorkbenchState | null; error: string | null; revision: number };
  /**
   * Save only if nobody else (e.g. another tab) saved since `expectedRevision`.
   * On conflict nothing is written; the caller reloads the newer state.
   */
  save(state: WorkbenchState, expectedRevision: number): SaveResult;
}

export const STORAGE_KEY = 'roofing-recovery-workbench:v2';
export const REVISION_KEY = `${STORAGE_KEY}:revision`;
export const BACKUP_KEY = `${STORAGE_KEY}:unreadable-backup`;

const ARRAYS = ['contractors', 'pilots', 'records', 'suppression', 'imports', 'timeEntries', 'expenses', 'events'] as const;
const ELIGIBILITY = new Set(['pending_review', 'eligible', 'ineligible', 'excluded', 'suppressed']);
const TOUCH = new Set(['draft', 'awaiting_approval', 'approved', 'contacted', 'blocked', 'cancelled']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string) => typeof o[k] === 'string';
const num = (o: Obj, k: string) => typeof o[k] === 'number' && Number.isFinite(o[k]);

/** Shape check deep enough that the UI and domain cannot crash on loaded data. Returns a problem description or null. */
export function validateState(value: unknown): string | null {
  if (!isObj(value)) return 'not an object';
  if (value.schemaVersion !== 2) return `unsupported schema version ${String(value.schemaVersion)}`;
  if (!num(value, 'nextId')) return 'missing id counter';
  for (const k of ARRAYS) if (!Array.isArray(value[k])) return `missing ${k}`;
  const v = value as unknown as Record<(typeof ARRAYS)[number], unknown[]>;
  for (const c of v.contractors) if (!isObj(c) || !str(c, 'id') || !str(c, 'businessName')) return 'invalid contractor';
  for (const p of v.pilots) {
    if (!isObj(p) || !str(p, 'id') || !str(p, 'contractorId') || !str(p, 'name') || !Array.isArray(p.approvedChannels) || !Array.isArray(p.sequence) || !num(p, 'recordLimit')) return 'invalid pilot';
  }
  for (const r of v.records) {
    if (!isObj(r) || !str(r, 'id') || !str(r, 'pilotId') || !str(r, 'customerName') || !num(r, 'estimateAmount') || !num(r, 'version')) return 'invalid record';
    if (!isObj(r.eligibility) || !ELIGIBILITY.has(r.eligibility.status as string)) return `invalid eligibility on ${String(r.id)}`;
    if (!isObj(r.authorization) || !isObj(r.original) || !Array.isArray(r.touches)) return `invalid record ${String(r.id)}`;
    for (const t of r.touches) if (!isObj(t) || !str(t, 'id') || !TOUCH.has(t.status as string) || !num(t, 'step')) return `invalid message on ${String(r.id)}`;
  }
  for (const e of v.suppression) if (!isObj(e) || !str(e, 'contractorId') || typeof e.active !== 'boolean') return 'invalid suppression entry';
  for (const e of v.events) if (!isObj(e) || !str(e, 'id') || !str(e, 'type') || !str(e, 'at')) return 'invalid history event';
  for (const t of v.timeEntries) if (!isObj(t) || !str(t, 'pilotId') || !num(t, 'minutes')) return 'invalid time entry';
  for (const x of v.expenses) if (!isObj(x) || !str(x, 'pilotId') || !num(x, 'amount')) return 'invalid expense';
  for (const i of v.imports) if (!isObj(i) || !str(i, 'pilotId')) return 'invalid import batch';
  return null;
}

/** Ensure the id counter is above every id in use, so new ids can never collide. */
export function repairIdCounter(state: WorkbenchState): WorkbenchState {
  let max = 0;
  const see = (id: unknown) => {
    const m = typeof id === 'string' ? /-(\d+)$/.exec(id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const list of [state.contractors, state.pilots, state.suppression, state.imports, state.timeEntries, state.expenses, state.events]) for (const x of list) see(x.id);
  for (const r of state.records) {
    see(r.id);
    if (r.handoff) see(r.handoff.id);
    for (const t of r.touches) see(t.id);
  }
  return state.nextId > max ? state : { ...state, nextId: max + 1 };
}

export function createLocalStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): WorkbenchStore {
  const readRevision = () => {
    const n = Number(storage?.getItem(REVISION_KEY) ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    load() {
      let raw: string | null | undefined;
      let revision = 0;
      try {
        raw = storage?.getItem(STORAGE_KEY);
        revision = readRevision();
      } catch {
        return { state: null, error: 'Browser storage is not available; changes will not be saved.', revision };
      }
      if (!raw) return { state: null, error: null, revision };
      let problem = 'not valid JSON';
      try {
        const parsed: unknown = JSON.parse(raw);
        const invalid = validateState(parsed);
        if (!invalid) return { state: repairIdCounter(parsed as WorkbenchState), error: null, revision };
        problem = invalid;
      } catch {
        // fall through
      }
      try {
        storage?.setItem(BACKUP_KEY, raw);
      } catch {
        // ignore
      }
      return { state: null, error: `Saved data could not be read (${problem}). A copy was kept in browser storage under "${BACKUP_KEY}"; the demo data was loaded instead.`, revision };
    },
    save(state, expectedRevision) {
      try {
        if (readRevision() !== expectedRevision) return { ok: false, reason: 'conflict' };
        const revision = expectedRevision + 1;
        // The state is one JSON value: either all of a command's changes persist or none do.
        storage?.setItem(STORAGE_KEY, JSON.stringify(state));
        storage?.setItem(REVISION_KEY, String(revision));
        return { ok: true, revision };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
