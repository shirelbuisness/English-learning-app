import type { ReactNode } from 'react';
import { PRIORITY_LABELS, type PriorityCategory } from '../domain/priority.ts';
import { WORKFLOW_LABELS, type WorkflowStatus } from '../domain/queue.ts';
import { ELIGIBILITY_SHORT, TOUCH_STATUS_LABELS, type EligibilityStatus, type TouchStatus } from '../domain/types.ts';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Tone = 'red' | 'amber' | 'navy' | 'green' | 'slate' | 'plain';
const TONES: Record<Tone, string> = {
  red: 'bg-red-50 text-red-800 ring-red-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  navy: 'bg-navy-50 text-navy-800 ring-navy-100',
  green: 'bg-sage-50 text-sage-700 ring-sage-100',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  plain: 'bg-white text-slate-500 ring-slate-200',
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone])}>
      {children}
    </span>
  );
}

const PRIORITY_TONE: Record<PriorityCategory, Tone> = { high: 'red', medium: 'amber', low: 'slate', none: 'plain', review: 'navy' };
export const PriorityBadge = ({ p }: { p: PriorityCategory }) => <Badge tone={PRIORITY_TONE[p]}>{PRIORITY_LABELS[p]}</Badge>;

const ELIG_TONE: Record<EligibilityStatus, Tone> = { pending_review: 'navy', eligible: 'green', ineligible: 'slate', excluded: 'amber', suppressed: 'red' };
export const EligibilityBadge = ({ s }: { s: EligibilityStatus }) => <Badge tone={ELIG_TONE[s]}>{ELIGIBILITY_SHORT[s]}</Badge>;

const WF_TONE: Record<WorkflowStatus, Tone> = {
  needs_review: 'navy',
  restricted: 'red',
  ready: 'slate',
  draft: 'slate',
  awaiting_approval: 'amber',
  approved: 'navy',
  in_sequence: 'slate',
  reply: 'green',
  qualified: 'green',
  handoff: 'green',
  handoff_acknowledged: 'green',
  outcome_reported: 'green',
  sequence_complete: 'plain',
  closed: 'plain',
};
export const WorkflowBadge = ({ s }: { s: WorkflowStatus }) => <Badge tone={WF_TONE[s]}>{WORKFLOW_LABELS[s]}</Badge>;

const TOUCH_TONE: Record<TouchStatus, Tone> = { draft: 'slate', awaiting_approval: 'amber', approved: 'navy', contacted: 'green', blocked: 'red', cancelled: 'plain' };
export const TouchBadge = ({ s }: { s: TouchStatus }) => <Badge tone={TOUCH_TONE[s]}>{TOUCH_STATUS_LABELS[s]}</Badge>;

export function Card({ title, subtitle, action, children, className, tone }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: 'alert' }) {
  return (
    <section className={cx('min-w-0 rounded-lg border bg-white', tone === 'alert' ? 'border-red-300' : 'border-slate-200', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-navy-900">{title}</h2>}
            {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
  size = 'md',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'confirm' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md';
  title?: string;
}) {
  const styles = {
    primary: 'bg-navy-800 text-white hover:bg-navy-900 disabled:bg-slate-300',
    confirm: 'bg-sage-700 text-white hover:bg-sage-600 disabled:bg-slate-300',
    secondary: 'bg-white text-navy-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-navy-900 disabled:text-slate-300',
    danger: 'bg-white text-red-800 ring-1 ring-inset ring-red-300 hover:bg-red-50 disabled:text-slate-400',
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx('rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', styles)}
    >
      {children}
    </button>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-navy-700 focus:outline-none focus:ring-1 focus:ring-navy-700 disabled:bg-slate-50';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'alert' | 'good' }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-0.5 text-xl font-semibold tabular-nums', tone === 'alert' ? 'text-red-800' : tone === 'good' ? 'text-sage-700' : 'text-navy-900')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Callout({ tone, children }: { tone: 'red' | 'amber' | 'navy' | 'green'; children: ReactNode }) {
  const t = {
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    navy: 'border-navy-100 bg-navy-50 text-navy-900',
    green: 'border-sage-100 bg-sage-50 text-sage-700',
  }[tone];
  return <div className={cx('rounded-md border px-3 py-2 text-sm', t)}>{children}</div>;
}

export const th = 'px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const td = 'px-3 py-2.5 align-top';
