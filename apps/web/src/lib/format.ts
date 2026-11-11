import type { Currency } from '@seatbook/shared';

/** 0.7333 → "73%". */
export const formatPercent = (ratio: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(ratio);

/** 1284 → "1,284". */
export const formatCount = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** Minor units → "$12K" / "BDT 1.2M": for axis ticks, where full amounts don't fit. */
export const formatMoneyCompact = (minor: number, currency: Currency) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100);

/**
 * A 'YYYY-MM-DD' that is ALREADY a day in the event's zone → "Jun 10". Formatted as UTC, so the
 * browser's own zone can't shift it a day (new Date('2030-06-10') is midnight UTC).
 */
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
