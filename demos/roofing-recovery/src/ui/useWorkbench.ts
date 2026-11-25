import { useCallback, useEffect, useRef, useState } from 'react';
import { withDemoData } from '../data/demoSeed.ts';
import { clockFromDate } from '../domain/dates.ts';
import { emptyState } from '../domain/state.ts';
import type { Clock, WorkbenchState } from '../domain/types.ts';
import { createLocalStore, REVISION_KEY } from '../storage/localStore.ts';

export interface Notice {
  kind: 'success' | 'error' | 'warning';
  text: string;
  id: number;
}

type AnyResult = { ok: true; state: WorkbenchState; message: string } | { ok: false; error: string };

const store = createLocalStore(typeof window === 'undefined' ? undefined : window.localStorage);
export const now = (): Clock => clockFromDate(new Date());

/**
 * The UI's only access to state. Every change goes through a domain command;
 * the resulting state is saved in one write.
 */
export function useWorkbench() {
  const [boot] = useState(() => {
    const loaded = store.load();
    let state = loaded.state;
    let error = loaded.error;
    let revision = loaded.revision;
    if (!state) {
      try {
        state = withDemoData(emptyState(), now().today);
      } catch (e) {
        state = emptyState();
        error = `${error ? `${error} ` : ''}The demo data could not be built (${(e as Error).message}); starting empty.`;
      }
      // Never overwrite stored data we could not read; it stays until a successful command saves over it.
      if (!loaded.error) {
        const saved = store.save(state, revision);
        if (saved.ok) revision = saved.revision;
      }
    }
    return { state, error, revision };
  });
  const [state, setState] = useState<WorkbenchState>(boot.state);
  const latest = useRef(state);
  const revision = useRef(boot.revision);
  const [notice, setNotice] = useState<Notice | null>(boot.error ? { kind: 'warning', text: boot.error, id: 0 } : null);

  const notify = useCallback((kind: Notice['kind'], text: string) => setNotice({ kind, text, id: Date.now() + Math.random() }), []);

  const reloadFromStorage = useCallback(() => {
    const loaded = store.load();
    if (!loaded.state) return false;
    latest.current = loaded.state;
    revision.current = loaded.revision;
    setState(loaded.state);
    return true;
  }, []);

  // Another tab saved: load its state rather than keep working on a stale copy.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === REVISION_KEY && reloadFromStorage()) notify('warning', 'Data was changed in another tab. The latest version has been loaded.');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [notify, reloadFromStorage]);

  /** Persist first; only show the new state once it is saved (or storage is known to be unavailable). */
  const commit = useCallback(
    (next: WorkbenchState): boolean => {
      const saved = store.save(next, revision.current);
      if (!saved.ok && saved.reason === 'conflict') {
        reloadFromStorage();
        notify('error', 'Not saved: the data was changed in another tab. The latest version is now loaded — please repeat the action.');
        return false;
      }
      if (saved.ok) revision.current = saved.revision;
      else notify('warning', 'Could not save to browser storage. Changes are kept only until this tab is closed.');
      latest.current = next;
      setState(next);
      return true;
    },
    [notify, reloadFromStorage],
  );

  /** Run a domain command. Returns the result so callers can show batch details or reset forms. */
  const run = useCallback(
    <R extends AnyResult>(command: (s: WorkbenchState, c: Clock) => R, opts: { quiet?: boolean } = {}): R => {
      let result: R;
      try {
        result = command(latest.current, now());
      } catch (e) {
        // An unexpected error (a bug, not a rule violation): nothing was changed.
        const error = `Unexpected error — nothing was changed: ${(e as Error).message}`;
        notify('error', error);
        return { ok: false, error } as R;
      }
      if (!result.ok) notify('error', result.error);
      else if (!commit(result.state)) return { ok: false, error: 'Conflict with another tab' } as R;
      else if (!opts.quiet) notify('success', result.message);
      return result;
    },
    [commit, notify],
  );

  return { state, run, notice, notify, dismissNotice: useCallback(() => setNotice(null), []) };
}

export type Workbench = ReturnType<typeof useWorkbench>;

export function download(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
