import type { PipelineStage, Types } from 'mongoose';
import {
  eventPhase,
  type DayRow,
  type EventDashboardDto,
  type PaletteColor,
  type TicketStatus,
} from '@seatbook/shared';
import { Booking, Scan, Seat, Ticket, type EventLean } from '../../db/models';
import { dayIn, fillDays, maxDay, minDay } from '../../lib/dates';

/**
 * queries.md §14.1–14.2 · FR-DASH-01..04. Every number is AGGREGATED from the source of truth;
 * `events.counters` are display copies and only `seatsSellable` (fixed at publish) is read here.
 * The service takes an already-scoped event: the organizer route loads it with findOwnedEvent, the
 * admin route with findAnyEvent, so ownership stays in the routes' finders.
 */

export const DASHBOARD_EVENT_FIELDS =
  'title status timezone currency counters startsAt endsAt publishedAt salesStartAt salesEndAt tiers';
export type DashboardEvent = Pick<
  EventLean,
  | '_id'
  | 'title'
  | 'status'
  | 'timezone'
  | 'currency'
  | 'counters'
  | 'startsAt'
  | 'endsAt'
  | 'publishedAt'
  | 'salesStartAt'
  | 'salesEndAt'
  | 'tiers'
>;

/** Ratios rounded in ONE place, so the fixture compares exact numbers. The UI formats them anyway. */
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

const SALES_PER_DAY = (tz: string): PipelineStage.FacetPipelineStage[] => [
  {
    $group: {
      // Calendar day in the EVENT's zone: 23:30 in New York is that evening, not tomorrow in UTC.
      _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: tz } },
      tickets: { $sum: { $size: '$items' } },
      revenue: { $sum: '$total' },
    },
  },
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        cumTickets: { $sum: '$tickets', window: { documents: ['unbounded', 'current'] } },
        cumRevenue: { $sum: '$revenue', window: { documents: ['unbounded', 'current'] } },
      },
    },
  },
  { $project: { _id: 0, day: '$_id', tickets: 1, revenue: 1, cumTickets: 1, cumRevenue: 1 } },
  { $sort: { day: 1 } },
];

type TicketFacets = {
  byStatus: { _id: TicketStatus; n: number }[];
  byTier: { _id: Types.ObjectId; sold: number; revenue: number }[];
  checkinsOverTime: { _id: Date; n: number }[];
};
type BookingFacets = { totals: { revenue: number }[]; perDay: DayRow[] };

export async function eventDashboard(ev: DashboardEvent, now: Date): Promise<EventDashboardDto> {
  const tz = ev.timezone;
  // One round trip per collection, all in parallel.
  const [[t], [b], heldNow, duplicateScans, sellableByTier] = await Promise.all([
    Ticket.aggregate<TicketFacets>([
      { $match: { eventId: ev._id } }, // { eventId, status }
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          byTier: [
            { $match: { status: { $ne: 'void' } } },
            { $group: { _id: '$tierId', sold: { $sum: 1 }, revenue: { $sum: '$price' } } },
          ],
          checkinsOverTime: [
            { $match: { status: 'checked_in' } },
            {
              $group: {
                _id: {
                  $dateTrunc: { date: '$checkedInAt', unit: 'minute', binSize: 5, timezone: tz },
                },
                n: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]),
    Booking.aggregate<BookingFacets>([
      { $match: { eventId: ev._id, status: 'confirmed' } }, // { eventId, status, createdAt }
      {
        $facet: {
          totals: [{ $group: { _id: null, revenue: { $sum: '$total' } } }],
          perDay: SALES_PER_DAY(tz),
        },
      },
    ]),
    // A held seat past its expiry is free (lazy expiry), whether or not the sweeper has run.
    Seat.countDocuments({ eventId: ev._id, status: 'held', holdExpiresAt: { $gt: now } }),
    Scan.countDocuments({ eventId: ev._id, result: 'already_checked_in' }), // { eventId, result }
    Seat.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { eventId: ev._id, status: { $ne: 'blocked' } } }, // { eventId, status, tierId }
      { $group: { _id: '$tierId', n: { $sum: 1 } } },
    ]),
  ]);

  const count = (s: TicketStatus) => t!.byStatus.find((x) => x._id === s)?.n ?? 0;
  const sold = count('issued') + count('checked_in'); // requirement §15.4: never "bookings × seats"
  const checkedIn = count('checked_in');
  const revenue = b!.totals[0]?.revenue ?? 0;
  const sellable = ev.counters?.seatsSellable ?? 0; // fixed at publish

  const perDay = b!.perDay;
  const fromDay = dayIn(ev.publishedAt ?? now, tz);
  // A hold made just before sales close can still be paid a few minutes later (BR-11): never cut
  // its row off.
  const lastSalesDay = maxDay(
    dayIn(ev.salesEndAt ?? ev.startsAt, tz),
    perDay.at(-1)?.day ?? fromDay,
  );
  const toDay = minDay(dayIn(now, tz), lastSalesDay);

  const soldBy = new Map(t!.byTier.map((r) => [String(r._id), r]));
  const sellBy = new Map(sellableByTier.map((r) => [String(r._id), r.n]));
  const tiers = ev.tiers
    .map((tier) => {
      const id = String(tier._id);
      return {
        tierId: id,
        name: tier.name,
        color: tier.color as PaletteColor,
        sold: soldBy.get(id)?.sold ?? 0,
        sellable: sellBy.get(id) ?? 0,
        revenue: soldBy.get(id)?.revenue ?? 0,
      };
    })
    .sort((x, y) => y.revenue - x.revenue); // stable: ties keep the organizer's order

  return {
    event: {
      id: String(ev._id),
      title: ev.title,
      timezone: tz,
      currency: ev.currency,
      startsAt: ev.startsAt.toISOString(),
      phase: eventPhase(ev, now),
    },
    generatedAt: now.toISOString(),
    kpi: {
      sold,
      sellable,
      soldPct: sellable ? round4(sold / sellable) : 0,
      revenue,
      avgTicketPrice: sold ? Math.round(revenue / sold) : 0,
      checkedIn,
      checkinRate: sold ? round4(checkedIn / sold) : 0,
      heldNow,
      duplicateScans,
    },
    salesPerDay: fillDays(perDay, fromDay, toDay),
    tiers,
    checkinsOverTime: t!.checkinsOverTime.map((r) => ({ at: r._id.toISOString(), n: r.n })),
  };
}
