import type { AuditEvent, Clock, Result, WorkbenchState } from './types.ts';

export function emptyState(): WorkbenchState {
  return {
    schemaVersion: 2,
    contractors: [],
    pilots: [],
    records: [],
    suppression: [],
    imports: [],
    timeEntries: [],
    expenses: [],
    events: [],
    nextId: 1,
  };
}

/** A rule violation. Thrown inside a transaction; the transaction is discarded. */
export class DomainError extends Error {}

export function fail(message: string): never {
  throw new DomainError(message);
}

export interface Tx {
  /** Working copy. Mutate freely; it replaces the state only if the command succeeds. */
  s: WorkbenchState;
  clock: Clock;
  id: (prefix: string) => string;
  log: (event: Partial<Omit<AuditEvent, 'id' | 'at'>> & { type: string; detail: string }) => void;
}

/**
 * Run a command atomically: it works on a copy, and either every change
 * (including its audit events) is kept, or none is.
 */
export function transact(state: WorkbenchState, clock: Clock, fn: (tx: Tx) => string): Result {
  const s = structuredClone(state);
  const tx: Tx = {
    s,
    clock,
    id: (prefix) => `${prefix}-${s.nextId++}`,
    log: (e) => {
      s.events.push({
        id: `ev-${s.nextId++}`,
        at: clock.now,
        contractorId: null,
        pilotId: null,
        recordId: null,
        from: null,
        to: null,
        ...e,
      });
    },
  };
  try {
    const message = fn(tx);
    return { ok: true, state: s, message };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Unwrap a result in tests and seed code. */
export function must(result: Result): WorkbenchState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
