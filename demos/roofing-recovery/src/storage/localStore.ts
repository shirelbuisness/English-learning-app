import type { WorkbenchState } from '../domain/types.ts';

/*
 * Persistence boundary. The rest of the app only sees `load` and `save`.
 * This implementation uses browser localStorage: unencrypted, per-browser,
 * not suitable for real customer data. A database-backed store can replace it
 * behind the same two functions.
 */
export interface WorkbenchStore {
  /** `error` is set when saved data existed but could not be read; it is backed up, not discarded. */
  load(): { state: WorkbenchState | null; error: string | null };
  save(state: WorkbenchState): boolean;
}

export const STORAGE_KEY = 'roofing-recovery-workbench:v2';
export const BACKUP_KEY = `${STORAGE_KEY}:unreadable-backup`;

const ARRAYS = ['contractors', 'pilots', 'records', 'suppression', 'imports', 'timeEntries', 'expenses', 'events'] as const;

export function isWorkbenchState(value: unknown): value is WorkbenchState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === 2 && typeof v.nextId === 'number' && ARRAYS.every((k) => Array.isArray(v[k]));
}

export function createLocalStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): WorkbenchStore {
  return {
    load() {
      let raw: string | null | undefined;
      try {
        raw = storage?.getItem(STORAGE_KEY);
      } catch {
        return { state: null, error: 'Browser storage is not available; changes will not be saved.' };
      }
      if (!raw) return { state: null, error: null };
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isWorkbenchState(parsed)) return { state: parsed, error: null };
      } catch {
        // fall through
      }
      try {
        storage?.setItem(BACKUP_KEY, raw);
      } catch {
        // ignore
      }
      return { state: null, error: `Saved data could not be read. A copy was kept in browser storage under "${BACKUP_KEY}"; the demo data was loaded instead.` };
    },
    save(state) {
      try {
        // One write of the whole state: either all of a command's changes persist or none do.
        storage?.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },
  };
}
