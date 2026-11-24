import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSeedLeads } from '../data/seedLeads.ts';
import { importLeadsCsv } from '../logic/csv.ts';
import { DEMO_AS_OF } from '../logic/dates.ts';
import { computeMetrics } from '../logic/metrics.ts';
import { clearLeads, loadLeads, saveLeads } from '../logic/storage.ts';
import type { Lead } from '../logic/types.ts';
import type { TransitionResult } from '../logic/workflow.ts';

export interface Notice {
  kind: 'success' | 'error';
  text: string;
  id: number;
}

const storage = typeof window === 'undefined' ? undefined : window.localStorage;

/** The single source of truth for the demo: one lead list, everything else derived. */
export function useDemo() {
  const [leads, setLeads] = useState<Lead[]>(() => loadLeads(storage) ?? createSeedLeads());
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => saveLeads(storage, leads), [leads]);

  const notify = useCallback((kind: Notice['kind'], text: string) => setNotice({ kind, text, id: Date.now() }), []);

  const metrics = useMemo(() => computeMetrics(leads, DEMO_AS_OF), [leads]);

  /** Apply a validated workflow transition to one lead. */
  const apply = useCallback(
    (leadId: string, transition: (lead: Lead) => TransitionResult, successText?: string) => {
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return;
      const result = transition(lead);
      if (!result.ok) {
        notify('error', result.error);
        return;
      }
      setLeads((prev) => prev.map((l) => (l.id === leadId ? result.lead : l)));
      if (successText) notify('success', successText);
    },
    [leads, notify],
  );

  const reset = useCallback(() => {
    clearLeads(storage);
    setLeads(createSeedLeads());
    notify('success', 'Demo data reset to the original sample.');
  }, [notify]);

  const importCsv = useCallback(
    (text: string): string[] | null => {
      const result = importLeadsCsv(text, new Set(leads.map((l) => l.id)), DEMO_AS_OF);
      if (!result.ok) return result.errors;
      setLeads((prev) => [...prev, ...result.leads]);
      notify('success', `Imported ${result.leads.length} lead${result.leads.length === 1 ? '' : 's'}.`);
      return null;
    },
    [leads, notify],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { leads, metrics, notice, dismissNotice, apply, reset, importCsv };
}

export type Demo = ReturnType<typeof useDemo>;
