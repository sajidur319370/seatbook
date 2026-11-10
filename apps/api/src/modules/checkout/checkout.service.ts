import { Types } from 'mongoose';
import { HOLD, type BookingDto, type Currency, type PaymentToken } from '@seatbook/shared';
import {
  Booking,
  CLEAR_HOLD,
  Event,
  Hold,
  Seat,
  Ticket,
  type BookingLean,
  type HoldLean,
} from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { publish } from '../../events/publish';
import { addSeconds, subSeconds } from '../../lib/dates';
import { AppError, conflict, gone, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { isDuplicateKey } from '../../lib/mongoErrors';
import { bookingReference, manualCode, sha256 } from '../../lib/ticketCodes';
import { sendMail } from '../../mail/mailer';
import { bookingConfirmed } from '../../mail/templates';
import { PaymentDeclined, payments, type Charge } from '../../payments/mockProvider';
import type { Ctx } from '../../types/ctx';
import { bookingDto } from '../bookings/booking.dto';
import { SEAT_CHANGE_FIELDS, toSeatChange, type SeatChangeRow } from '../holds/hold.service';

/**
 * queries.md §10: the checkout saga.
 *   charge (external, can't be in a transaction) → commit (one transaction) → if commit fails, refund.
 * Rule: no payment call, no emit, no email inside withTransaction (database.md §6.2 rule 2).
 */

type Result = { status: 200 | 201; booking: BookingDto };

/** The seats aren't all held by this hold any more, or another checkout took over the lock. */
class SeatsLostError extends Error {}

type CheckoutEvent = {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  venue: { name: string; city: string };
  timezone: string;
  startsAt: Date;
  currency: Currency;
  seatMap: { sections: { _id: Types.ObjectId; name: string }[] };
  tiers: { _id: Types.ObjectId; name: string }[];
};

type CheckoutSeat = SeatChangeRow & {
  label: string;
  sectionId: Types.ObjectId;
  row: string;
  number: number;
  tierId: Types.ObjectId;
  price: number;
};

/** Gives the lock back, keeping the hold, but only if it's still OUR lock (not a takeover's). */
const unlock = (holdId: Types.ObjectId, lockedAt: Date) =>
  Hold.updateOne(
    { _id: holdId, checkoutStartedAt: lockedAt },
    { $set: { checkoutStartedAt: null } },
  );

/** The lock CAS matched nothing: say why, in the order a buyer would care about. */
async function whyNoLock(ctx: Ctx, eventId: Types.ObjectId, now: Date): Promise<AppError> {
  const h = await Hold.findOne({ eventId, userId: ctx.userId, status: 'active' }).lean<HoldLean>();
  if (!h) return notFound('You have no seats held for this event.');
  if (h.expiresAt <= now) return gone('HOLD_EXPIRED', 'Your seats were released.');
  if (h.checkoutAttempts >= HOLD.maxCheckoutAttempts)
    return conflict('TOO_MANY_ATTEMPTS', 'Too many payment attempts for these seats.');
  return conflict('CHECKOUT_IN_PROGRESS', 'A payment for these seats is already in progress.');
}

export async function checkout(
  ctx: Ctx,
  eventId: Types.ObjectId,
  input: { paymentToken: PaymentToken },
  idempotencyKey: string,
): Promise<Result> {
  // 1. Replay (§10.1, AP12): the same Pay request again gets the same booking, and no new charge.
  const existing = await Booking.findOne({
    userId: ctx.userId,
    idempotencyKey,
  }).lean<BookingLean>();
  if (existing) return { status: 200, booking: await bookingDto(existing) };

  // 2. Event. It doesn't have to be on sale: a hold created in time can be paid until it expires (BR-11).
  const ev = await Event.findOne({ _id: eventId, status: 'published' })
    .select(
      'title slug venue timezone startsAt currency seatMap.sections._id seatMap.sections.name tiers._id tiers.name',
    )
    .lean<CheckoutEvent>();
  if (!ev) throw notFound();

  // 3. Lock + payment window: ONE CAS on the hold (§10.2).
  const now = ctx.now();
  const hold = await Hold.findOneAndUpdate(
    {
      eventId: ev._id,
      userId: ctx.userId,
      status: 'active',
      expiresAt: { $gt: now }, // E6: too late to start paying
      checkoutAttempts: { $lt: HOLD.maxCheckoutAttempts }, // E12: declines can't extend the hold forever
      $or: [
        { checkoutStartedAt: null },
        { checkoutStartedAt: { $lt: subSeconds(now, HOLD.checkoutLockStaleSec) } }, // E11: a crashed checkout
      ],
    },
    {
      $set: { checkoutStartedAt: now },
      $inc: { checkoutAttempts: 1 },
      $max: { expiresAt: addSeconds(now, HOLD.paymentWindowSec) }, // extend, never shorten (FR-PAY-04)
    },
    { new: true },
  ).lean<HoldLean>();
  if (!hold) {
    // A retry of this same payment may have finished between step 1 and here: that's a replay too,
    // not "you have no seats held".
    const done = await Booking.findOne({ userId: ctx.userId, idempotencyKey }).lean<BookingLean>();
    if (done) return { status: 200, booking: await bookingDto(done) };
    throw await whyNoLock(ctx, ev._id, now);
  }

  // 4. The same window on the seats: they're the truth for claims and for the sweeper (E7).
  await Seat.updateMany(
    { holdId: hold._id, status: 'held' },
    { $max: { holdExpiresAt: hold.expiresAt }, $inc: { version: 1 } },
  );
  const seats = await Seat.find({ holdId: hold._id, status: 'held' })
    .select('_id eventId label sectionId row number tierId price status version holdExpiresAt')
    .lean<CheckoutSeat[]>();
  if (!seats.length) {
    await unlock(hold._id, now);
    throw conflict('HOLD_EMPTY', 'You have no seats held for this event.');
  }
  await publish(ctx, [
    { type: 'seats.changed', eventId: ev._id, changes: seats.map(toSeatChange) }, // other maps move their timers
    { type: 'hold.changed', userId: ctx.userId, eventId: ev._id, reason: 'payment_window' },
  ]);

  // 5. Total from the seats' stored prices: never from the client (NFR-SEC-15).
  const total = seats.reduce((sum, s) => sum + s.price, 0);

  // 6. Charge (§10.3), outside any transaction.
  let payment: Charge;
  try {
    payment = await payments.charge({
      amount: total,
      currency: ev.currency,
      token: input.paymentToken,
      idempotencyKey,
    });
  } catch (err) {
    await unlock(hold._id, now); // keep the hold: the buyer can try another card
    if (err instanceof PaymentDeclined)
      throw new AppError(402, 'PAYMENT_DECLINED', 'Your card was declined.');
    logger.error({ err }, 'checkout.provider_error');
    throw new AppError(
      502,
      'PAYMENT_PROVIDER_ERROR',
      'The payment provider is unavailable. You were not charged.',
    );
  }

  // 7. Booking transaction, all or nothing (§10.4).
  // seatIds are the seats we CHARGED for, captured before the charge: the count check compares to these.
  const seatIds = seats.map((s) => s._id);
  const sectionNames = new Map(ev.seatMap.sections.map((s) => [String(s._id), s.name]));
  const tierNames = new Map(ev.tiers.map((t) => [String(t._id), t.name]));

  let booking: BookingLean | null = null;
  for (let attempt = 0; attempt < 3 && !booking; attempt++) {
    // Retries only for random-ID collisions (reference, manual code).
    const bookingId = new Types.ObjectId();
    const tickets = seats.map((s) => {
      const ticketId = new Types.ObjectId();
      return {
        _id: ticketId,
        eventId: ev._id,
        bookingId,
        userId: ctx.userId,
        seatId: s._id,
        seatKey: s._id,
        seatLabel: s.label,
        sectionName: sectionNames.get(String(s.sectionId)) ?? '',
        row: s.row,
        number: s.number,
        tierId: s.tierId,
        tierName: tierNames.get(String(s.tierId)) ?? '',
        price: s.price,
        currency: ev.currency,
        holderName: ctx.name,
        eventTitle: ev.title,
        eventStartsAt: ev.startsAt,
        manualCodeHash: sha256(manualCode(ticketId)), // §11: the code itself is never stored
      };
    });

    try {
      booking = await withTransaction(async (session) => {
        // (1) held → booked, only if STILL held by THIS hold (I7)
        const res = await Seat.updateMany(
          { _id: { $in: seatIds }, eventId: ev._id, holdId: hold._id, status: 'held' },
          { $set: { status: 'booked', bookingId, ...CLEAR_HOLD }, $inc: { version: 1 } },
          { session },
        );
        if (res.modifiedCount !== seatIds.length) throw new SeatsLostError();

        // (2) booking (unique holdId I8, unique (userId, idempotencyKey) I9, unique reference)
        const [b] = await Booking.create(
          [
            {
              _id: bookingId,
              reference: bookingReference(), // SB-XXXX-XXXX
              userId: ctx.userId,
              eventId: ev._id,
              holdId: hold._id,
              idempotencyKey,
              items: tickets.map((t) => ({
                seatId: t.seatId,
                label: t.seatLabel,
                sectionName: t.sectionName,
                row: t.row,
                number: t.number,
                tierId: t.tierId,
                tierName: t.tierName,
                price: t.price,
              })),
              total,
              currency: ev.currency,
              buyer: { name: ctx.name, email: ctx.email },
              event: {
                title: ev.title,
                slug: ev.slug,
                startsAt: ev.startsAt,
                venueName: ev.venue.name,
                city: ev.venue.city,
                timezone: ev.timezone,
              },
              payment: {
                provider: 'mock',
                chargeId: payment.chargeId,
                brand: payment.brand,
                last4: payment.last4,
                amount: total,
                paidAt: payment.paidAt,
              },
            },
          ],
          { session },
        );

        // (3) tickets (one live ticket per seat, I10)
        await Ticket.insertMany(tickets, { session, ordered: true });

        // (4) close the hold, only if our lock is still the current one
        const closed = await Hold.updateOne(
          { _id: hold._id, status: 'active', checkoutStartedAt: now },
          { $set: { status: 'converted', checkoutStartedAt: null } },
          { session },
        );
        if (closed.modifiedCount !== 1) throw new SeatsLostError(); // a stale-lock takeover happened
        return b!.toObject() as BookingLean;
      });
    } catch (err) {
      if (isDuplicateKey(err, 'uniq_booking_reference') || isDuplicateKey(err, 'uniq_manual_code'))
        continue; // new random IDs
      return compensate(ctx, { err, payment, hold, now, idempotencyKey });
    }
  }
  if (!booking) {
    return compensate(ctx, {
      err: new Error('No unique booking reference after 3 tries'),
      payment,
      hold,
      now,
      idempotencyKey,
    });
  }

  // 9. After commit: tell everyone, then mail. None of this can undo the booking.
  logger.info(
    { bookingId: booking._id, eventId: ev._id, seats: seatIds.length, total },
    'checkout.booked',
  );
  const changes = (
    await Seat.find({ _id: { $in: seatIds } })
      .select(SEAT_CHANGE_FIELDS)
      .lean<SeatChangeRow[]>()
  ).map(toSeatChange);
  await publish(ctx, [
    { type: 'seats.changed', eventId: ev._id, changes }, // booked (grey) for everyone
    { type: 'hold.changed', userId: ctx.userId, eventId: ev._id, reason: 'converted' },
    { type: 'booking.confirmed', userId: ctx.userId, eventId: ev._id, bookingId: booking._id },
    { type: 'sales.changed', eventId: ev._id, seats: seatIds.length, revenue: total },
  ]);
  sendMail({ to: booking.buyer.email, ...bookingConfirmed(booking) });

  return { status: 201, booking: await bookingDto(booking) };
}

/** 8. Compensation (§10.5, FR-PAY-08): the charge happened, the booking didn't. */
async function compensate(
  ctx: Ctx,
  f: { err: unknown; payment: Charge; hold: HoldLean; now: Date; idempotencyKey: string },
): Promise<Result> {
  // A booking for this key means our request lost a race with ITSELF (same key, e.g. a stale-lock
  // retry). Both share one chargeId (§10.3), so a refund would refund the winner. Return it instead.
  const winner = await Booking.findOne({
    userId: ctx.userId,
    idempotencyKey: f.idempotencyKey,
  }).lean<BookingLean>();
  if (winner) return { status: 200, booking: await bookingDto(winner) };

  await payments.refund(f.payment.chargeId);
  await unlock(f.hold._id, f.now);

  // uniq_booking_hold: another checkout of this hold (another key) already booked it (schema.md §14).
  if (f.err instanceof SeatsLostError || isDuplicateKey(f.err, 'uniq_booking_hold')) {
    throw conflict(
      'SEATS_LOST',
      "Some seats were released before payment finished. You weren't charged.",
    );
  }
  throw f.err; // → 500 INTERNAL_ERROR (the refund is already done)
}
