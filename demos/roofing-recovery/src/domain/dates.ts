import type { Clock, IsoDate, Timestamp } from './types.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const toUtc = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Clock for the operator's local calendar day. */
export function clockFromDate(d: Date): Clock {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { now: d.toISOString(), today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

/** Clock at noon UTC on a given day; used by tests and the demo seed. */
export function clockAt(today: IsoDate, hour = 12): Clock {
  return { now: `${today}T${String(hour).padStart(2, '0')}:00:00.000Z`, today };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: IsoDate | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1] ?? '?'} ${Number(d)}, ${y}`;
}

export function formatShortDate(date: IsoDate | null | undefined): string {
  if (!date) return '—';
  const [, m, d] = date.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1] ?? '?'} ${Number(d)}`;
}

export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUsd(value: number, cents = false): string {
  return (cents ? usd2 : usd).format(value);
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}
