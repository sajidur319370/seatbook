import type { Currency } from './constants';

/** Minor units (cents) → "$75.00" / "৳1,200.00". All v1 currencies have 2 minor digits. */
export function formatMoney(minor: number, currency: Currency, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

/** "75.5" typed by an organizer → 7550. Rejects more than 2 decimals. */
export function toMinor(major: string | number): number | null {
  const s = String(major).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}
