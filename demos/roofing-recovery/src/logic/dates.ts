import type { IsoDate } from './types.ts';

/**
 * Fixed "today" for the demonstration so that priorities and lead ages are
 * the same every time the demo is opened.
 */
export const DEMO_AS_OF: IsoDate = '2026-11-20';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-31` → `Oct 31, 2026`. */
export function formatDate(date: IsoDate | null): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? '?'} ${Number(d)}, ${y}`;
}

/** `2026-10-31` → `Oct 31`. */
export function formatShortDate(date: IsoDate): string {
  const [, m, d] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? '?'} ${Number(d)}`;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function formatUsd(value: number): string {
  return usd.format(value);
}
