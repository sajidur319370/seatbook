import type { Types } from 'mongoose';
import {
  eventPhase,
  HOLD,
  type EventStatus,
  type HeldSeatDto,
  type HoldResponse,
  type SeatStatus,
} from '@seatbook/shared';
import { CLEAR_HOLD, Event, Hold, Seat, type EventLean, type HoldLean } from '../../db/models';
import { publish } from '../../events/publish';
import type { SeatChange } from '../../events/types';
import { addMinutes, subSeconds } from '../../lib/dates';
import { conflict, gone, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { isDuplicateKey } from '../../lib/mongoErrors';
import type { Ctx } from '../../types/ctx';

export const SEAT_CHANGE_FIELDS = {
  _id: 1,
  eventId: 1,
  status: 1,
  version: 1,
  holdExpiresAt: 1,
} as const;

type SeatChangeRow = {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  status: SeatStatus;
  version: number;
  holdExpiresAt?: Date | null;
};

/** Identity-free on purpose: this is what other buyers will receive (no heldBy, no holdId). */
export const toSeatChange = (s: SeatChangeRow): SeatChange => ({
  seatId: String(s._id),
  status: s.status,
  version: s.version,
  holdExpiresAt: s.status === 'held' && s.holdExpiresAt ? s.holdExpiresAt.toISOString() : null,
});

/** A checkout lock older than this was left by a crash, and no longer blocks anything (E11). */
const checkoutRunning = (hold: Pick<HoldLean, 'checkoutStartedAt'>, now: Date) =>
  !!hold.checkoutStartedAt && hold.checkoutStartedAt > subSeconds(now, HOLD.checkoutLockStaleSec);

function assertNoCheckout(hold: Pick<HoldLean, 'checkoutStartedAt'>, now: Date) {
  if (checkoutRunning(hold, now)) {
    throw conflict('CHECKOUT_IN_PROGRESS', 'Your payment is being processed.'); // don't pull seats out from under it
  }
}

type OnSaleEvent = {
  _id: Types.ObjectId;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  maxSeatsPerOrder: number;
};

/** queries.md §8.1 */
async function loadOnSaleEvent(eventId: Types.ObjectId, now: Date) {
  const ev = await Event.findOne({ _id: eventId, status: 'published' })
    .select('status startsAt endsAt salesStartAt salesEndAt maxSeatsPerOrder')
    .lean<OnSaleEvent>();
  if (!ev) throw notFound();
  if (eventPhase(ev, now) !== 'on_sale')
    throw conflict('EVENT_NOT_ON_SALE', 'Tickets for this event are not on sale right now.');
  return ev;
}

/** queries.md §8.2: one active hold per user per event (AP7, AP8). */
async function getOrCreateHold(ctx: Ctx, ev: OnSaleEvent, now: Date): Promise<HoldLean> {
  const mine = { eventId: ev._id, userId: ctx.userId, status: 'active' };
  const existing = await Hold.findOne(mine).lean<HoldLean>();
  if (existing && existing.expiresAt > now) return existing;

  if (existing) {
    // Expired but not yet swept. Retire it so the partial unique index frees up.
    // Its seats are already free (lazy expiry); the sweeper will broadcast them.
    await Hold.updateOne(
      { _id: existing._id, status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
    );
  }

  const active = await Hold.countDocuments({
    userId: ctx.userId,
    status: 'active',
    expiresAt: { $gt: now },
  });
  if (active >= HOLD.maxActiveHoldsPerUser) {
    throw conflict(
      'TOO_MANY_HOLDS',
      `You can hold seats for up to ${HOLD.maxActiveHoldsPerUser} events at once.`,
    ); // FR-HOLD-12
  }

  try {
    const [created] = await Hold.create([
      { eventId: ev._id, userId: ctx.userId, expiresAt: addMinutes(now, HOLD.minutes) },
    ]);
    return created!.toObject() as HoldLean;
  } catch (err) {
    if (!isDuplicateKey(err, 'one_active_hold')) throw err;
    // E2: my other tab created it a moment ago, so use theirs.
    const theirs = await Hold.findOne(mine).lean<HoldLean>();
    if (!theirs) throw err;
    return theirs;
  }
}

/** Marks a hold with no seats as released. The size check means a concurrent add is never lost. */
const releaseIfEmpty = (holdId: Types.ObjectId) =>
  Hold.updateOne(
    { _id: holdId, status: 'active', seatIds: { $size: 0 } },
    { $set: { status: 'released' } },
  );

/**
 * Giving up an empty hold (below) can send a parallel click back for a new one, so a click gets a
 * few tries before the client is told to retry (FR-HOLD-14).
 */
const MAX_ATTEMPTS = 3;

/** queries.md §8.3: reserve a slot → claim the seat → give the slot back if the claim failed. */
export async function addSeat(ctx: Ctx, eventId: Types.ObjectId, seatId: Types.ObjectId) {
  const now = ctx.now();
  const ev = await loadOnSaleEvent(eventId, now);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hold = await getOrCreateHold(ctx, ev, now);
    if (hold.seatIds.some((id) => id.equals(seatId))) return holdView(ctx, hold._id, now); // FR-HOLD-06

    // 1. Reserve a slot in the hold (I6: the size check is atomic with the push).
    const reserved = await Hold.findOneAndUpdate(
      {
        _id: hold._id,
        status: 'active',
        expiresAt: { $gt: now },
        seatIds: { $ne: seatId },
        $expr: { $lt: [{ $size: '$seatIds' }, ev.maxSeatsPerOrder] },
      },
      { $addToSet: { seatIds: seatId } },
      { new: true },
    ).lean<HoldLean>();

    if (!reserved) {
      const h = await Hold.findOne({ _id: hold._id })
        .select('status expiresAt seatIds')
        .lean<Pick<HoldLean, 'status' | 'expiresAt' | 'seatIds'>>();
      if (!h || h.status !== 'active' || h.expiresAt <= now) continue; // gone in between → new hold
      if (h.seatIds.some((id) => id.equals(seatId))) return holdView(ctx, hold._id, now); // E3
      throw conflict('HOLD_LIMIT', `You can hold up to ${ev.maxSeatsPerOrder} seats.`);
    }

    // 2. Claim the seat: THE double-booking guard (I4). One document, one atomic write.
    const claimed = await Seat.findOneAndUpdate(
      {
        _id: seatId,
        eventId: ev._id,
        $or: [
          { status: 'available' },
          { status: 'held', holdExpiresAt: { $lte: now } }, // lazy expiry (FR-EXP-01)
        ],
      },
      {
        $set: {
          status: 'held',
          holdId: hold._id,
          heldBy: ctx.userId,
          holdExpiresAt: reserved.expiresAt, // the hold's expiry: adding a seat never extends it (BR-03)
        },
        $inc: { version: 1 },
      },
      { new: true, projection: SEAT_CHANGE_FIELDS },
    ).lean<SeatChangeRow>();

    if (!claimed) {
      // 3. Compensate: give the slot back, and leave nothing behind. If a click on a taken seat left
      // an empty hold, its timer would already be running on the buyer's next seat, and it would
      // count toward the limit on events held at once.
      await Hold.updateOne({ _id: hold._id }, { $pull: { seatIds: seatId } });
      await releaseIfEmpty(hold._id);
      logger.info({ eventId, seatId, userId: ctx.userId }, 'seat.conflict');
      const exists = await Seat.exists({ _id: seatId, eventId: ev._id });
      if (!exists) throw notFound();
      throw conflict('SEAT_UNAVAILABLE', 'Someone just took that seat.', {
        seatId: String(seatId),
      });
    }

    logger.info({ eventId, seatId, userId: ctx.userId }, 'seat.held');
    await publish(ctx, [
      { type: 'seats.changed', eventId: ev._id, changes: [toSeatChange(claimed)] },
      { type: 'hold.changed', userId: ctx.userId, eventId: ev._id, reason: 'seat_added' },
    ]);
    return holdView(ctx, hold._id, now);
  }
  throw gone('HOLD_EXPIRED', 'Your hold expired. Please try again.');
}

/** queries.md §8.4: the CAS filter is what stops anyone releasing a seat that isn't theirs. */
async function releaseSeat(hold: Pick<HoldLean, '_id' | 'eventId'>, seatId: Types.ObjectId) {
  const seat = await Seat.findOneAndUpdate(
    { _id: seatId, eventId: hold.eventId, holdId: hold._id, status: 'held' },
    { $set: { status: 'available', ...CLEAR_HOLD }, $inc: { version: 1 } },
    { new: true, projection: SEAT_CHANGE_FIELDS },
  ).lean<SeatChangeRow>();
  await Hold.updateOne({ _id: hold._id }, { $pull: { seatIds: seatId } });
  if (seat) logger.info({ eventId: hold.eventId, seatId }, 'seat.released');
  return seat; // null → wasn't mine (or already released)
}

export async function removeSeat(ctx: Ctx, eventId: Types.ObjectId, seatId: Types.ObjectId) {
  const now = ctx.now();
  const hold = await Hold.findOne({
    eventId,
    userId: ctx.userId,
    status: 'active',
  }).lean<HoldLean>();
  if (!hold) throw notFound();
  assertNoCheckout(hold, now);

  const seat = await releaseSeat(hold, seatId);
  await releaseIfEmpty(hold._id);

  await publish(ctx, [
    ...(seat ? [{ type: 'seats.changed' as const, eventId, changes: [toSeatChange(seat)] }] : []),
    { type: 'hold.changed' as const, userId: ctx.userId, eventId, reason: 'seat_removed' as const },
  ]);
  return holdView(ctx, hold._id, now);
}

/**
 * Takes a context so admins and the sweeper can call it with systemCtx(). It finds seats by holdId,
 * because the seat is the truth and seatIds can list a seat whose claim never happened
 * (data-model.md §12.1).
 *
 * A click already past its reserve step can still claim a seat just after this runs. That seat stays
 * held by a released hold until its expiry, and lazy expiry then frees it. Nothing is double-booked,
 * so this isn't worth an extra query on every click.
 */
export async function releaseAllSeats(
  ctx: Ctx,
  hold: Pick<HoldLean, '_id' | 'eventId' | 'userId'>,
) {
  const seats = await Seat.find({ holdId: hold._id, status: 'held' }).select('_id').lean();
  const changes: SeatChange[] = [];
  for (const { _id } of seats) {
    const seat = await releaseSeat(hold, _id); // ≤ 10
    if (seat) changes.push(toSeatChange(seat));
  }
  await Hold.updateOne({ _id: hold._id, status: 'active' }, { $set: { status: 'released' } });
  await publish(ctx, [
    ...(changes.length ? [{ type: 'seats.changed' as const, eventId: hold.eventId, changes }] : []),
    {
      type: 'hold.changed' as const,
      userId: hold.userId,
      eventId: hold.eventId,
      reason: 'released' as const,
    },
  ]);
}

/** The buyer's own "release all" (FR-HOLD-08), which respects a running payment. */
export async function releaseMyHold(ctx: Ctx, eventId: Types.ObjectId) {
  const now = ctx.now();
  const hold = await Hold.findOne({
    eventId,
    userId: ctx.userId,
    status: 'active',
  }).lean<HoldLean>();
  if (!hold) throw notFound();
  assertNoCheckout(hold, now);
  await releaseAllSeats(ctx, hold);
  return holdView(ctx, null, now);
}

/** queries.md §8.5: FR-HOLD-09. */
export async function holdView(
  ctx: Ctx,
  holdId: Types.ObjectId | null,
  now = ctx.now(),
): Promise<HoldResponse> {
  const empty = { hold: null, serverTime: now.toISOString() }; // FR-HOLD-10
  const hold = holdId
    ? await Hold.findOne({ _id: holdId, userId: ctx.userId }).lean<HoldLean>()
    : null;
  if (!hold || hold.status !== 'active' || hold.expiresAt <= now) return empty;

  // The truth is on the seats (data-model.md §12.1): list what this hold really holds.
  const [ev, seats] = await Promise.all([
    Event.findOne({ _id: hold.eventId })
      .select('currency tiers._id tiers.name seatMap.sections._id seatMap.sections.name')
      .lean<Pick<EventLean, 'currency' | 'tiers' | 'seatMap'>>(),
    Seat.find({ holdId: hold._id, status: 'held' })
      .select('_id label sectionId row number tierId price')
      .lean(),
  ]);
  if (!ev) return empty;

  const sectionName = new Map(ev.seatMap?.sections.map((s) => [String(s._id), s.name]));
  const tierName = new Map(ev.tiers.map((t) => [String(t._id), t.name]));
  const views = seats.map((s): HeldSeatDto => ({
    id: String(s._id),
    label: s.label,
    section: sectionName.get(String(s.sectionId)) ?? '',
    row: s.row,
    number: s.number,
    tierId: String(s.tierId),
    tierName: tierName.get(String(s.tierId)) ?? '',
    price: s.price,
  }));
  // A steady order, so the buyer's list doesn't jump around. Numeric: A2 comes before A10.
  views.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    serverTime: now.toISOString(),
    hold: {
      id: String(hold._id),
      eventId: String(hold.eventId),
      expiresAt: hold.expiresAt.toISOString(),
      checkoutInProgress: checkoutRunning(hold, now),
      seats: views,
      total: views.reduce((sum, s) => sum + s.price, 0),
      currency: ev.currency,
    },
  };
}
