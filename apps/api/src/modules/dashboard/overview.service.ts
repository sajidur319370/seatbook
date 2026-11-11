import {
  EVENT_PHASES,
  eventPhase,
  ROLES,
  type AdminOverviewDto,
  type Currency,
  type EventPhase,
  type OrganizerOverviewDto,
  type Role,
} from '@seatbook/shared';
import { Booking, Event, OrganizerApplication, User, type EventLean } from '../../db/models';
import { dayIn, fillCounts, subDays } from '../../lib/dates';
import type { Ctx } from '../../types/ctx';

/** queries.md §14.3 · FR-DASH-09: totals across the caller's OWN events only. */
export async function organizerOverview(ctx: Ctx): Promise<OrganizerOverviewDto> {
  const now = ctx.now();
  const tz = (await User.findOne({ _id: ctx.userId }).select('timezone').lean())?.timezone ?? 'UTC';
  const events = await Event.find({ organizerId: ctx.userId }) // { organizerId, startsAt }
    .sort({ startsAt: -1 })
    .limit(200)
    .select('title status startsAt endsAt salesStartAt salesEndAt timezone currency counters')
    .lean<EventLean[]>();
  const since = subDays(now, 30);

  const [overview] = await Booking.aggregate<{
    revenueByCurrency: { _id: Currency; revenue: number; tickets: number }[];
    last30Days: { _id: string; tickets: number }[];
  }>([
    { $match: { eventId: { $in: events.map((e) => e._id) }, status: 'confirmed' } },
    {
      $facet: {
        revenueByCurrency: [
          {
            $group: {
              _id: '$currency',
              revenue: { $sum: '$total' },
              tickets: { $sum: { $size: '$items' } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        last30Days: [
          { $match: { createdAt: { $gte: since, $lte: now } } },
          {
            $group: {
              _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: tz } },
              tickets: { $sum: { $size: '$items' } },
            },
          },
        ],
      },
    },
  ]);

  return {
    // Lists may use the display counters: that's what they're for (project overview §12.7).
    upcoming: events
      .filter((e) => e.status === 'published' && e.endsAt > now)
      .sort((a, b) => +a.startsAt - +b.startsAt)
      .slice(0, 10)
      .map((e) => ({
        id: String(e._id),
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        timezone: e.timezone,
        currency: e.currency,
        phase: eventPhase(e, now),
        sold: e.counters?.seatsSold ?? 0,
        sellable: e.counters?.seatsSellable ?? 0,
        revenue: e.counters?.revenue ?? 0,
      })),
    totals: {
      ticketsSold: overview!.revenueByCurrency.reduce((n, r) => n + r.tickets, 0),
      eventsOnSale: events.filter((e) => eventPhase(e, now) === 'on_sale').length,
      // Per currency: never add BDT to USD (requirement Q8).
      revenue: overview!.revenueByCurrency.map((r) => ({ currency: r._id, amount: r.revenue })),
    },
    last30Days: fillCounts(
      overview!.last30Days.map((r) => ({ day: r._id, tickets: r.tickets })),
      dayIn(subDays(now, 29), tz),
      dayIn(now, tz),
    ),
  };
}

/**
 * The phase computed INSIDE the pipeline, with the same rules as eventPhase() (packages/shared
 * phase.ts). A test compares the two, so changing the rules in one place only fails CI.
 */
export const phaseSwitch = (now: Date) => ({
  $switch: {
    branches: [
      { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
      { case: { $eq: ['$status', 'draft'] }, then: 'draft' },
      { case: { $gte: [now, '$endsAt'] }, then: 'ended' },
      // A null salesStartAt never matches: in BSON order null sorts below any date.
      { case: { $lt: [now, '$salesStartAt'] }, then: 'scheduled' },
      { case: { $gte: [now, { $ifNull: ['$salesEndAt', '$startsAt'] }] }, then: 'sales_closed' },
    ],
    default: 'on_sale',
  },
});

/** queries.md §14.4 · FR-DASH-10. Days are UTC here (requirement §15.4). */
export async function adminOverview(now: Date): Promise<AdminOverviewDto> {
  const [usersByRole, pendingApplications, eventsByPhase, gmv, ticketsPerDay] = await Promise.all([
    User.aggregate<{ _id: { role: Role; suspended: boolean }; n: number }>([
      {
        $group: {
          _id: { role: '$role', suspended: { $gt: ['$suspendedAt', null] } },
          n: { $sum: 1 },
        },
      },
    ]),
    OrganizerApplication.countDocuments({ status: 'pending' }),
    Event.aggregate<{ _id: EventPhase; n: number }>([
      { $group: { _id: phaseSwitch(now), n: { $sum: 1 } } },
    ]),
    Booking.aggregate<{ _id: Currency; revenue: number; bookings: number }>([
      { $match: { status: 'confirmed' } },
      { $group: { _id: '$currency', revenue: { $sum: '$total' }, bookings: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Booking.aggregate<{ _id: string; tickets: number }>([
      // { status, createdAt }
      { $match: { status: 'confirmed', createdAt: { $gte: subDays(now, 30), $lte: now } } },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, // UTC
          tickets: { $sum: { $size: '$items' } },
        },
      },
    ]),
  ]);

  // Every role and every phase is present, zeros included, so the UI never guesses.
  const users = Object.fromEntries(ROLES.map((r) => [r, 0])) as AdminOverviewDto['users'];
  users.suspended = 0;
  for (const g of usersByRole) {
    users[g._id.role] += g.n; // a suspended user still counts under their role
    if (g._id.suspended) users.suspended += g.n;
  }
  const phases = Object.fromEntries(EVENT_PHASES.map((p) => [p, 0])) as Record<EventPhase, number>;
  for (const g of eventsByPhase) phases[g._id] = g.n;

  return {
    users,
    pendingApplications,
    eventsByPhase: phases,
    gmv: gmv.map((g) => ({ currency: g._id, revenue: g.revenue, bookings: g.bookings })),
    ticketsPerDay: fillCounts(
      ticketsPerDay.map((r) => ({ day: r._id, tickets: r.tickets })),
      dayIn(subDays(now, 29), 'UTC'),
      dayIn(now, 'UTC'),
    ),
  };
}
