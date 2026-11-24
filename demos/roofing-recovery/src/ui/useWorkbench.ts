import { useCallback, useRef, useState } from 'react';
import { withDemoData } from '../data/demoSeed.ts';
import { clockFromDate } from '../domain/dates.ts';
import { emptyState } from '../domain/state.ts';
import type { Clock, WorkbenchState } from '../domain/types.ts';
import { createLocalStore } from '../storage/localStore.ts';

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
    const state = loaded.state ?? withDemoData(emptyState(), now().today);
    if (!loaded.state && !loaded.error) store.save(state);
    return { state, error: loaded.error };
  });
  const [state, setState] = useState<WorkbenchState>(boot.state);
  const latest = useRef(state);
  const [notice, setNotice] = useState<Notice | null>(boot.error ? { kind: 'warning', text: boot.error, id: 0 } : null);

  const notify = useCallback((kind: Notice['kind'], text: string) => setNotice({ kind, text, id: Date.now() + Math.random() }), []);

  const commit = useCallback(
    (next: WorkbenchState) => {
      latest.current = next;
      setState(next);
      if (!store.save(next)) notify('warning', 'Could not save to browser storage. Changes are kept only until this tab is closed.');
    },
    [notify],
  );

  /** Run a domain command. Returns the result so callers can show batch details or reset forms. */
  const run = useCallback(
    <R extends AnyResult>(command: (s: WorkbenchState, c: Clock) => R, opts: { quiet?: boolean } = {}): R => {
      const result = command(latest.current, now());
      if (!result.ok) notify('error', result.error);
      else {
        commit(result.state);
        if (!opts.quiet) notify('success', result.message);
      }
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
