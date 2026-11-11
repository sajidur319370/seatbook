import { formatInTimeZone } from 'date-fns-tz';
import type { DayRow } from '@seatbook/shared';

export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const addSeconds = (d: Date, n: number) => new Date(d.getTime() + n * 1000);
export const subSeconds = (d: Date, n: number) => new Date(d.getTime() - n * 1000);
export const subDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

/** The calendar day of an instant, as seen in a time zone: 'YYYY-MM-DD'. */
export const dayIn = (d: Date, tz: string) => formatInTimeZone(d, tz, 'yyyy-MM-dd');
export const minDay = (a: string, b: string) => (a < b ? a : b); // ISO day strings compare as text
export const maxDay = (a: string, b: string) => (a > b ? a : b);

/** Inclusive list of day strings. Pure string arithmetic in UTC, so DST can't skip or repeat a day. */
export function calendarDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * One row per day; missing days get zero sales and carry the running totals forward. A Map lookup,
 * not a walk by index (queries.md §14.2), so a row outside the range can't shift later days.
 */
export function fillDays(rows: DayRow[], from: string, to: string): DayRow[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  let last = { cumTickets: 0, cumRevenue: 0 };
  return calendarDays(from, to).map((day) => {
    const r = byDay.get(day);
    if (r) return (last = r);
    return {
      day,
      tickets: 0,
      revenue: 0,
      cumTickets: last.cumTickets,
      cumRevenue: last.cumRevenue,
    };
  });
}

export function fillCounts(rows: { day: string; tickets: number }[], from: string, to: string) {
  const byDay = new Map(rows.map((r) => [r.day, r.tickets]));
  return calendarDays(from, to).map((day) => ({ day, tickets: byDay.get(day) ?? 0 }));
}
