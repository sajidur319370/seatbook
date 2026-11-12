import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { Booking, Event, Hold, Seat } from '../src/db/models';
import { repairCounters } from '../src/ops/counters';
import { checkInvariants } from '../src/ops/invariants';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeOrganizer } from './helpers/roles';
import { makePublishedEvent } from './factories/events';

describe('invariant checker (NFR-REL-03)', () => {
  let eventId: string;
  let bookedSeatId: string;
  let bookingId: string;

  beforeEach(async () => {
    const org = await makeOrganizer();
    const ev = await makePublishedEvent(org.token);
    eventId = ev.eventId;
    const [rafi, mina] = await makeBuyers(2);
    await holdSeats(rafi!.token, eventId, [ev.seats[0]!.id, ev.seats[1]!.id]);
    bookingId = (await pay(rafi!.token, eventId)).body.booking.id;
    bookedSeatId = ev.seats[0]!.id;
    await holdSeats(mina!.token, eventId, [ev.seats[5]!.id]); // an honest open hold
  });

  it('a real purchase plus an open hold: all zeros', async () => {
    const r = await checkInvariants();
    expect(r.counts).toEqual({ v1: 0, v2: 0, v3: 0, v4: 0, v5: 0, v6: 0 });
    expect(r.total).toBe(0);
  });

  it('V1 + V2: a booked seat and its live ticket that disagree are both reported', async () => {
    // Behind the booking's back, the seat is made available again.
    await Seat.updateOne({ _id: bookedSeatId }, { $set: { status: 'available', bookingId: null } });
    expect((await checkInvariants()).counts.v2).toBe(1); // the ticket's seat isn't booked

    await Seat.updateOne(
      { _id: bookedSeatId },
      { $set: { status: 'booked', bookingId: new Types.ObjectId() } },
    );
    const r = await checkInvariants();
    expect(r.counts.v1).toBe(1); // booked by a booking its live ticket doesn't belong to
    expect(r.samples.v1).toHaveLength(1);
  });

  it('V3: a seat still held by a released hold', async () => {
    const seat = (await Seat.findOne({ eventId, status: 'held' }).lean())!;
    await Hold.updateOne({ _id: seat.holdId }, { $set: { status: 'released' } });
    expect((await checkInvariants()).counts.v3).toBe(1);
  });

  it('V5: a booking total that is not the sum of its items', async () => {
    await Booking.updateOne({ _id: bookingId }, { $inc: { total: 1 } });
    expect((await checkInvariants()).counts.v5).toBe(1);
  });

  it('V6: drifted display counters are reported, and repair:counters fixes them', async () => {
    await Event.updateOne({ _id: eventId }, { $inc: { 'counters.seatsSold': 5 } });
    expect((await checkInvariants()).counts.v6).toBe(1);

    const fixed = await repairCounters({ apply: true });
    expect(fixed).toEqual([expect.objectContaining({ field: 'seatsSold', stored: 7, actual: 2 })]);
    expect((await checkInvariants()).total).toBe(0);
    expect((await Event.findById(eventId).lean())!.counters.seatsSold).toBe(2);
  });

  it('a dry run changes nothing', async () => {
    await Event.updateOne({ _id: eventId }, { $set: { 'counters.revenue': 1 } });
    expect(await repairCounters({ apply: false })).toHaveLength(1);
    expect((await Event.findById(eventId).lean())!.counters.revenue).toBe(1);
  });
});
