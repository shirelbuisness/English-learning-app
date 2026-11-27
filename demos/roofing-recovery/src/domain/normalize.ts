import type { Consent } from './types.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-case and trim; returns null when absent or not a plausible address. */
export function normalizeEmail(raw: string): { value: string | null; invalid: boolean } {
  const v = raw.trim().toLowerCase();
  if (v === '') return { value: null, invalid: false };
  return EMAIL.test(v) ? { value: v, invalid: false } : { value: null, invalid: true };
}

/** US phone numbers to E.164 (`+15125550142`); returns null when absent or not a valid NANP number. */
export function normalizePhone(raw: string): { value: string | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, invalid: false };
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[2-9]\d{2}[2-9]/.test(digits)) return { value: null, invalid: true };
  return { value: `+1${digits}`, invalid: false };
}

export function formatPhone(e164: string | null): string {
  if (!e164) return '—';
  const d = e164.replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

/**
 * Consent values. Anything not clearly "yes" is never treated as permission:
 * blank → unknown, unrecognised text → unknown (with a warning from the caller).
 */
export function normalizeConsent(raw: string): { value: Consent; recognised: boolean } {
  const v = raw.trim().toLowerCase();
  if (v === '') return { value: 'unknown', recognised: true };
  if (['yes', 'y', 'true', '1', 'opt-in', 'opted in', 'consented'].includes(v)) return { value: 'yes', recognised: true };
  if (['no', 'n', 'false', '0', 'opt-out', 'opted out', 'declined'].includes(v)) return { value: 'no', recognised: true };
  if (['unknown', 'unsure', '?', 'n/a'].includes(v)) return { value: 'unknown', recognised: true };
  return { value: 'unknown', recognised: false };
}

export function normalizeYesNo(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === '' || ['no', 'n', 'false', '0'].includes(v)) return false;
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  return null;
}
