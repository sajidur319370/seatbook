import type { EventDashboardDto } from '@seatbook/shared';

type Kpi = EventDashboardDto['kpi'];

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * Recomputes the ratios after a live patch, with the SAME rules as the server
 * (dashboard.service.ts), so a patched tile never disagrees with a refetched one.
 */
export function withDerived(k: Kpi): Kpi {
  return {
    ...k,
    soldPct: k.sellable ? round4(k.sold / k.sellable) : 0,
    avgTicketPrice: k.sold ? Math.round(k.revenue / k.sold) : 0,
    checkinRate: k.sold ? round4(k.checkedIn / k.sold) : 0,
  };
}

/** A `sales:updated` message (display counters): sold and revenue jump at once. */
export const applySales = (k: Kpi, p: { seatsSold: number; revenue: number }): Kpi =>
  withDerived({ ...k, sold: p.seatsSold, revenue: p.revenue });

/** A `checkin:recorded` message. Two sources can arrive out of order: checked-in only goes up. */
export const applyCheckin = (
  k: Kpi,
  p: { result: string; counts: { checkedIn: number; sold: number } },
): Kpi =>
  withDerived({
    ...k,
    checkedIn: Math.max(k.checkedIn, p.counts.checkedIn),
    sold: p.counts.sold,
    duplicateScans: k.duplicateScans + (p.result === 'already_checked_in' ? 1 : 0),
  });

const FIVE_MIN = 5 * 60_000;

/**
 * The API returns only non-empty 5-minute buckets. Fill the gaps from the first to the last bucket
 * (presentation, like fillDays on the server), so the chart's spacing is true to time.
 */
export function fillBuckets(rows: { at: string; n: number }[]): { at: string; n: number }[] {
  if (!rows.length) return [];
  const byTime = new Map(rows.map((r) => [Date.parse(r.at), r.n]));
  const from = Date.parse(rows[0]!.at);
  const to = Date.parse(rows.at(-1)!.at);
  const out: { at: string; n: number }[] = [];
  for (let t = from; t <= to && out.length < 1_000; t += FIVE_MIN) {
    out.push({ at: new Date(t).toISOString(), n: byTime.get(t) ?? 0 });
  }
  return out;
}
