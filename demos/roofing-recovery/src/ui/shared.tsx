import type { ReactNode } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS, type FollowUp, type LeadStatus, type Priority } from '../logic/types.ts';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-red-50 text-red-800 ring-red-200',
  medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  low: 'bg-slate-100 text-slate-700 ring-slate-200',
  none: 'bg-white text-slate-500 ring-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', PRIORITY_STYLES[priority])}>
      {priority !== 'none' && (
        <span
          aria-hidden
          className={cx('size-1.5 rounded-full', priority === 'high' ? 'bg-red-600' : priority === 'medium' ? 'bg-amber-500' : 'bg-slate-400')}
        />
      )}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  new_inquiry: 'text-navy-800 bg-navy-50',
  contacted: 'text-slate-700 bg-slate-100',
  estimate_sent: 'text-navy-800 bg-navy-50',
  customer_replied: 'text-red-800 bg-red-50',
  job_booked: 'text-sage-700 bg-sage-100',
  closed_lost: 'text-slate-500 bg-slate-100',
  opted_out: 'text-slate-500 bg-slate-100',
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={cx('rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLES[status])}>{STATUS_LABELS[status]}</span>;
}

export function followUpLabel(f: FollowUp): string | null {
  if (f.state === 'approved') return 'Approved, ready to send';
  if (f.state === 'completed') {
    if (f.outcome === 'appointment') return 'Completed · appointment';
    if (f.outcome === 'replied') return 'Completed · replied';
    return 'Completed';
  }
  if (f.state === 'dismissed') return 'Dismissed';
  return null;
}

export function FollowUpTag({ followUp }: { followUp: FollowUp }) {
  const label = followUpLabel(followUp);
  if (!label) return null;
  const style =
    followUp.state === 'approved'
      ? 'text-navy-800 ring-navy-700/30'
      : followUp.state === 'completed'
        ? 'text-sage-700 ring-sage-600/40 bg-sage-50'
        : 'text-slate-500 ring-slate-300';
  return <span className={cx('rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', style)}>{label}</span>;
}

export function Card({ title, subtitle, action, children, className }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-slate-200 bg-white', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-navy-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'alert' | 'good' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', tone === 'alert' ? 'text-red-800' : tone === 'good' ? 'text-sage-700' : 'text-navy-900')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'confirm' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-navy-800 text-white hover:bg-navy-900 disabled:bg-slate-300',
    confirm: 'bg-sage-700 text-white hover:bg-sage-600 disabled:bg-slate-300',
    secondary: 'bg-white text-navy-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:text-navy-900 hover:bg-slate-100 disabled:text-slate-300',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cx('rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed', styles)}>
      {children}
    </button>
  );
}

export const thClass = 'px-3 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const tdClass = 'px-3 py-3 align-top';
