import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { fromZonedTime } from 'date-fns-tz';
import { createEventSchema, newId, seatMapInputSchema } from '@seatbook/shared';
import { Booking, Seat, Ticket } from '../../src/db/models';
import { withTransaction } from '../../src/db/transaction';
import { qrCode } from '../../src/lib/ticketCodes';
import { checkIn } from '../../src/modules/checkin/checkin.service';
import { checkout } from '../../src/modules/checkout/checkout.service';
import { findOwnedEvent, type OwnedEventLean } from '../../src/modules/events/scope';
import { addSeat } from '../../src/modules/holds/hold.service';
import { createEvent } from '../../src/modules/organizer/event.service';
import { publishEvent } from '../../src/modules/organizer/publish.service';
import { saveSeatMap } from '../../src/modules/organizer/seatmap.service';
import { makeCtx } from '../../src/types/ctx';
import { makeBuyers } from '../helpers/buyers';
import { makeClock } from '../helpers/clock';
import { makeOrganizer } from '../helpers/roles';

/**
 * Day 19, AC-DASH-01. The REAL services (publish, addSeat, checkout, checkIn) on a fake clock, so
 * the dashboard is compared with numbers worked out by hand (dashboard.expected.json), never with
 * its own output. The story is in the Day 19 guide, Step 8a.
 */

export const TZ = 'America/New_York';
/** Wall-clock time in New York → instant. */
export const ny = (local: string) => fromZonedTime(local, TZ);

export async function buildDashboardFixture() {
  const clock = makeClock(ny('2030-06-10T09:00').toISOString());
  const at = (local: string) => clock.set(ny(local).toISOString());

  const org = await makeOrganizer();
  const orgCtx = makeCtx({
    userId: new Types.ObjectId(org.user.id),
    role: 'organizer',
    name: 'Nadia',
    now: clock.now,
  });

  const vip = { _id: newId(), name: 'VIP', price: 8000, color: 'purple' as const };
  const std = { _id: newId(), name: 'Standard', price: 5000, color: 'teal' as const };
  const val = { _id: newId(), name: 'Value', price: 3000, color: 'amber' as const };

  const draft = await createEvent(
    orgCtx,
    createEventSchema.parse({
      title: 'Dashboard Fixture Matinee',
      venue: { name: 'Fixture Hall', city: 'New York' },
      timezone: TZ,
      currency: 'USD',
      startsAt: ny('2030-06-14T12:00').toISOString(),
      endsAt: ny('2030-06-14T15:00').toISOString(),
    }),
  );
  await saveSeatMap(
    orgCtx,
    draft._id,
    seatMapInputSchema.parse({
      expectedRevision: draft.revision,
      tiers: [vip, std, val],
      sections: [
        {
          _id: newId(),
          name: 'Orchestra',
          code: 'ORC',
          x: 0,
          y: 0,
          rows: [
            { label: 'A', seats: 4, tierId: vip._id },
            { label: 'B', seats: 6, tierId: std._id },
            { label: 'C', seats: 6, tierId: val._id, blocked: [6] },
          ],
        },
      ],
    }),
  );
  await publishEvent(orgCtx, draft._id); // Mon 09:00 → publishedAt = salesStartAt
  const eventId = draft._id;
  // Day 18's checkIn takes the event the route's ownership check loaded, not just its id.
  const ev = await findOwnedEvent<OwnedEventLean>(orgCtx, eventId, '_id startsAt endsAt');

  const seatId = new Map((await Seat.find({ eventId }).lean()).map((s) => [s.label, s._id]));
  const buyers = (await makeBuyers(7)).map((b, i) =>
    makeCtx({
      userId: new Types.ObjectId(b.user.id),
      role: 'attendee',
      name: `Buyer ${i}`,
      email: `buyer${i}@test.dev`,
      now: clock.now,
    }),
  );

  async function buy(i: number, local: string, seats: string[]) {
    at(local);
    for (const s of seats) await addSeat(buyers[i]!, eventId, seatId.get(`ORC-${s}`)!);
    const { booking } = await checkout(
      buyers[i]!,
      eventId,
      { paymentToken: 'tok_visa' },
      randomUUID(),
    );
    return new Types.ObjectId(booking.id);
  }
  async function scan(local: string, seat: string | null) {
    at(local);
    const t = seat
      ? await Ticket.findOne({ eventId, seatLabel: `ORC-${seat}` })
          .select('_id eventId')
          .lean()
      : null;
    await checkIn(orgCtx, ev, {
      code: t ? qrCode(t._id, t.eventId) : 'not-a-ticket',
      method: 'qr',
      gate: 'Main',
    });
  }

  await buy(0, '2030-06-10T10:15', ['A1', 'A2']);
  await buy(1, '2030-06-10T23:30', ['B1', 'B2', 'B3']); // 03:30 UTC on 06-11
  const cancelled = await buy(2, '2030-06-12T11:00', ['C1', 'C2']);
  await buy(3, '2030-06-12T12:30', ['A3', 'B4']);
  await buy(4, '2030-06-13T09:45', ['B5', 'B6', 'C3']);
  at('2030-06-13T15:00');
  await cancelBooking(cancelled, clock.now());
  await buy(5, '2030-06-14T10:30', ['C4']);

  const scans: [string, string | null][] = [
    ['11:02', 'A1'],
    ['11:04', 'A2'],
    ['11:07', 'B1'],
    ['11:08', 'B2'],
    ['11:21', 'B3'],
    ['11:30', 'A1'], // duplicate
    ['11:31', 'B1'], // duplicate
    ['11:35', null], // garbage: invalid, NOT a duplicate
    ['11:43', 'A3'],
  ];
  for (const [time, seat] of scans) await scan(`2030-06-14T${time}`, seat);
  at('2030-06-14T11:50');
  await addSeat(buyers[6]!, eventId, seatId.get('ORC-C5')!); // held until 12:00, never paid
  await scan('2030-06-14T11:58', 'C4');

  return { eventId, orgCtx };
}

/**
 * Attendee cancellation is a Should (deferred). The fixture makes the same writes the future
 * service will, and deliberately leaves the display counters alone: a dashboard that read
 * counters instead of aggregating would fail the test.
 */
async function cancelBooking(bookingId: Types.ObjectId, now: Date) {
  await withTransaction(async (session) => {
    await Booking.updateOne(
      { _id: bookingId, status: 'confirmed' },
      { $set: { status: 'cancelled', cancelledAt: now, cancelReason: 'user' } },
      { session },
    );
    await Ticket.updateMany(
      { bookingId },
      { $set: { status: 'void', seatKey: null, voidedAt: now, voidReason: 'booking_cancelled' } },
      { session },
    );
    await Seat.updateMany(
      { bookingId },
      { $set: { status: 'available', bookingId: null }, $inc: { version: 1 } },
      { session },
    );
  });
}
