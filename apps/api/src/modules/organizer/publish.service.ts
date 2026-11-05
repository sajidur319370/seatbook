import type { Types } from 'mongoose';
import { generateSeats, scheduleIssues, validateLayout } from '@seatbook/shared';
import { Booking, Event, Hold, Seat, type EventLean } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict } from '../../lib/errors';
import { toSeatMapDto } from '../events/event.dto';
import { findOwnedEvent } from '../events/scope';
import type { Ctx } from '../../types/ctx';

class AlreadyPublishedOrStale extends Error {}

const ZERO_COUNTERS = {
  seatsTotal: 0,
  seatsSellable: 0,
  seatsSold: 0,
  ticketsCheckedIn: 0,
  revenue: 0,
};

/** Everything that must be true before seats are generated (FR-EVT-04). */
function assertPublishable(ev: EventLean, now: Date) {
  const layout = toSeatMapDto(ev);
  const issues: { path: (string | number)[]; message: string }[] = validateLayout({
    ...layout,
    expectedRevision: ev.revision,
  });
  if (!layout.tiers.length)
    issues.push({ path: ['tiers'], message: 'Add at least one price tier' });
  const sellable = generateSeats(layout).filter((s) => !s.blocked).length;
  if (sellable === 0)
    issues.push({ path: ['sections'], message: 'Add at least one seat that is for sale' });
  if (ev.startsAt <= now)
    issues.push({ path: ['startsAt'], message: 'The event must start in the future' });
  if ((ev.salesEndAt ?? ev.startsAt) <= now)
    issues.push({ path: ['salesEndAt'], message: 'Sales must end in the future' });
  issues.push(...scheduleIssues(ev));
  if (issues.length)
    throw badRequest('NOT_PUBLISHABLE', 'This event is not ready to publish.', issues);
}

/** queries.md §5.3: transaction, idempotent. */
export async function publishEvent(ctx: Ctx, eventId: Types.ObjectId) {
  const ev = await findOwnedEvent<EventLean>(ctx, eventId);
  if (ev.status === 'published') return ev; // idempotent
  if (ev.status !== 'draft')
    throw conflict('EVENT_NOT_DRAFT', 'A cancelled event cannot be published.');

  const now = ctx.now();
  assertPublishable(ev, now);
  // The string-id form: generated tierIds must match the keys of `prices` below.
  const generated = generateSeats(toSeatMapDto(ev));
  const prices = new Map(ev.tiers.map((t) => [String(t._id), t.price]));
  const sellable = generated.filter((s) => !s.blocked).length;

  await withTransaction(async (session) => {
    // Flip the status FIRST. A parallel publish hits a write conflict on this document;
    // the driver retries it, the retry's filter (status: 'draft') matches nothing, and it inserts no seats.
    const res = await Event.updateOne(
      { _id: ev._id, organizerId: ctx.userId, status: 'draft', revision: ev.revision },
      {
        $set: {
          status: 'published',
          publishedAt: now,
          salesStartAt: ev.salesStartAt ?? now,
          salesEndAt: ev.salesEndAt ?? ev.startsAt,
          counters: { ...ZERO_COUNTERS, seatsTotal: generated.length, seatsSellable: sellable },
        },
        $inc: { revision: 1 },
      },
      { session },
    );
    if (res.modifiedCount === 0) throw new AlreadyPublishedOrStale();

    await Seat.insertMany(
      generated.map((s) => ({
        eventId: ev._id,
        sectionId: s.sectionId,
        row: s.row,
        number: s.number,
        label: s.label,
        tierId: s.tierId,
        price: prices.get(s.tierId)!,
        x: s.x,
        y: s.y,
        status: s.blocked ? 'blocked' : 'available',
      })),
      { session, ordered: true }, // 5,000 docs ≈ 1.2 MB: fine in one transaction
    );
  }).catch(async (err) => {
    if (!(err instanceof AlreadyPublishedOrStale)) throw err;
    const latest = await findOwnedEvent(ctx, eventId, 'status');
    if (latest.status === 'published') return; // the other request won: same result
    throw conflict('STALE_DRAFT', 'This event was changed in another tab.');
  });

  return findOwnedEvent<EventLean>(ctx, eventId);
}

/** queries.md §5.4: back to draft, only with no bookings. */
export async function unpublishEvent(ctx: Ctx, eventId: Types.ObjectId) {
  // Publish fills in empty sales dates. Clear those, or moving the draft later would close sales
  // early, and moving it earlier would fail with an error about a date nobody chose.
  const before = await findOwnedEvent<EventLean>(ctx, eventId);
  const defaulted = {
    ...(before.salesStartAt?.getTime() === before.publishedAt?.getTime() && { salesStartAt: null }),
    ...(before.salesEndAt?.getTime() === before.startsAt.getTime() && { salesEndAt: null }),
  };

  await withTransaction(async (session) => {
    if (await Booking.exists({ eventId }).session(session))
      throw conflict('EVENT_HAS_BOOKINGS', 'This event already has bookings.');

    const res = await Event.updateOne(
      { _id: eventId, organizerId: ctx.userId, status: 'published' },
      {
        $set: { status: 'draft', publishedAt: null, counters: ZERO_COUNTERS, ...defaulted },
        $inc: { revision: 1 },
      },
      { session },
    );
    if (res.modifiedCount === 0)
      throw conflict('EVENT_NOT_PUBLISHED', 'This event is not published.');

    await Hold.updateMany(
      { eventId, status: 'active' },
      { $set: { status: 'released' } },
      { session },
    );
    await Seat.deleteMany({ eventId }, { session });
  });
  // Day 14: event:updated { phase: 'draft' } to event:<id>; hold:changed null to each holder (E13)

  return findOwnedEvent<EventLean>(ctx, eventId);
}
