import { useRef, useState, type ReactNode } from 'react';
import { Button } from './shared.tsx';

/** Copy text to the clipboard; falls back to selecting the text so the operator can press Ctrl/Cmd+C. */
export async function copyText(text: string, fallback?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      fallback.focus();
      fallback.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** Shows exactly what will be pasted, with a copy button. Copying changes nothing in the workbench. */
export function CopyPanel({ title, text, hint, onClose, children }: { title: string; text: string; hint?: ReactNode; onClose: () => void; children?: ReactNode }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  return (
    <div className="rounded-lg border border-navy-700 bg-white p-4 shadow-sm" role="region" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={async () => setState((await copyText(text, area.current)) ? 'copied' : 'manual')}>
            {state === 'copied' ? 'Copied ✓' : 'Copy to clipboard'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
      {state === 'manual' && <p className="mt-2 text-xs text-amber-900">Your browser blocked automatic copying. The text is selected: press Ctrl+C (Cmd+C on Mac).</p>}
      <textarea
        ref={area}
        readOnly
        aria-label={`${title} text`}
        value={text}
        rows={Math.min(18, text.split('\n').length + 1)}
        className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800"
      />
      {children && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">{children}</div>}
    </div>
  );
}
