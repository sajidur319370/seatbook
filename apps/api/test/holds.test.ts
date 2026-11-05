import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOLD } from '@seatbook/shared';
import { Event, Hold, Seat } from '../src/db/models';
import { addDays } from '../src/lib/dates';
import { app } from './setup/app';
import { makeDraft, makePublishedEvent, smallLayout } from './factories/events';
import { as, registerUser } from './helpers/auth';
import { holdUrl } from './helpers/buyers';
import { makeAdmin, makeOrganizer } from './helpers/roles';

const MINUTE = 60_000;
const click = (token: string, eventId: string, seatId: string) =>
  as(token)
    .post(`${holdUrl(eventId)}/seats`)
    .send({ seatId });

/** Moves a hold, and every seat it holds, to a new expiry. */
async function setHoldExpiry(holdId: unknown, expiresAt: Date) {
  await Hold.updateOne({ _id: holdId }, { $set: { expiresAt } });
  await Seat.updateMany({ holdId }, { $set: { holdExpiresAt: expiresAt } });
}

describe('holds', () => {
  let org: Awaited<ReturnType<typeof makeOrganizer>>;
  let rafi: Awaited<ReturnType<typeof registerUser>>;
  let mina: Awaited<ReturnType<typeof registerUser>>;
  let eventId: string;
  let seats: { id: string; label: string }[];

  beforeEach(async () => {
    org = await makeOrganizer();
    rafi = await registerUser('Rafi');
    mina = await registerUser('Mina');
    ({ eventId, seats } = await makePublishedEvent(org.token, { maxSeatsPerOrder: 8 }));
  });

  describe('holding a seat', () => {
    it('shows up in my hold, with names, prices and the server’s clock (FR-HOLD-09, 10)', async () => {
      const before = Date.now();
      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.status).toBe(200);

      const mine = await as(rafi.token).get(holdUrl(eventId));
      expect(mine.status).toBe(200);
      const { hold, serverTime } = mine.body;
      expect(hold).toMatchObject({
        eventId,
        checkoutInProgress: false,
        total: 4000,
        currency: 'BDT',
      });
      expect(hold.seats).toEqual([
        {
          id: seats[0]!.id,
          label: seats[0]!.label,
          section: 'L',
          row: 'A',
          number: 1,
          tierId: expect.any(String),
          tierName: 'Standard',
          price: 4000,
        },
      ]);
      const left = new Date(hold.expiresAt).getTime() - before;
      expect(left).toBeGreaterThan(9.9 * MINUTE);
      expect(left).toBeLessThan(10.1 * MINUTE);
      expect(new Date(serverTime).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('marks the seat held, without telling other buyers who holds it', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const seat = await Seat.findById(seats[0]!.id).lean();
      expect(seat).toMatchObject({ status: 'held', version: 2 });
      expect(String(seat!.heldBy)).toBe(rafi.user.id);

      const map = await request(app).get(`/api/events/${eventId}/seats`);
      expect(map.body.seats.find((c: { id: string }) => c.id === seats[0]!.id).st).toBe('held');
      expect(map.text).not.toMatch(/heldBy|holdId/);
      expect(map.text).not.toContain(rafi.user.id);
    });

    it('lowers the remaining count on the event page', async () => {
      const { slug } = (await Event.findById(eventId).lean())!;
      await click(rafi.token, eventId, seats[0]!.id);
      const res = await request(app).get(`/api/events/${slug}`);
      expect(res.body.event.tiers[0].remaining).toBe(29);
    });

    it('a second click on my seat changes nothing (FR-HOLD-06, E3)', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const again = await click(rafi.token, eventId, seats[0]!.id);
      expect(again.status).toBe(200);
      expect(again.body.hold.seats).toHaveLength(1);
      const hold = await Hold.findOne({ eventId, status: 'active' }).lean();
      expect(hold!.seatIds).toHaveLength(1);
      expect((await Seat.findById(seats[0]!.id).lean())!.version).toBe(2);
    });

    it('re-clicking a held seat works even when my hold is full', async () => {
      for (const s of seats.slice(0, 8)) await click(rafi.token, eventId, s.id);
      expect((await click(rafi.token, eventId, seats[0]!.id)).status).toBe(200);
      const ninth = await click(rafi.token, eventId, seats[8]!.id);
      expect(ninth.status).toBe(409);
      expect(ninth.body.error.code).toBe('HOLD_LIMIT');
    });

    it('adding a seat doesn’t extend the timer (BR-03)', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const hold = await Hold.findOne({ eventId, status: 'active' }).lean();
      const fiveLeft = new Date(Date.now() + 5 * MINUTE);
      await setHoldExpiry(hold!._id, fiveLeft);

      const res = await click(rafi.token, eventId, seats[1]!.id);
      expect(new Date(res.body.hold.expiresAt)).toEqual(fiveLeft);
      expect((await Seat.findById(seats[1]!.id).lean())!.holdExpiresAt).toEqual(fiveLeft);
    });

    it('lists my seats in a steady, numeric order', async () => {
      const [org2] = [org];
      const tier = {
        _id: new Types.ObjectId().toHexString(),
        name: 'T',
        price: 100,
        color: 'teal' as const,
      };
      const layout = {
        stageLabel: 'STAGE',
        tiers: [tier],
        sections: [
          {
            _id: new Types.ObjectId().toHexString(),
            name: 'Main',
            code: 'M',
            x: 0,
            y: 0,
            numbering: 'ltr' as const,
            rows: [
              { label: 'A', seats: 12, offset: 0, tierId: tier._id, gapsAfter: [], blocked: [] },
            ],
          },
        ],
      };
      const big = await makePublishedEvent(org2!.token, {}, layout);
      const byLabel = new Map(big.seats.map((s) => [s.label, s.id]));
      for (const label of ['M-A10', 'M-A2', 'M-A1']) {
        await click(rafi.token, big.eventId, byLabel.get(label)!);
      }
      const mine = await as(rafi.token).get(holdUrl(big.eventId));
      expect(mine.body.hold.seats.map((s: { label: string }) => s.label)).toEqual([
        'M-A1',
        'M-A2',
        'M-A10',
      ]);
      expect(mine.body.hold.total).toBe(300);
    });
  });

  describe('the order of my seats', () => {
    it('doesn’t depend on the order the database stores them', async () => {
      const layout = smallLayout();
      layout.sections.reverse(); // section R is created, and stored, before section L
      const ev = await makePublishedEvent(org.token, {}, layout);
      const byLabel = new Map(ev.seats.map((s) => [s.label, s.id]));
      await click(rafi.token, ev.eventId, byLabel.get('R-A1')!);
      await click(rafi.token, ev.eventId, byLabel.get('L-A1')!);
      const mine = await as(rafi.token).get(holdUrl(ev.eventId));
      expect(mine.body.hold.seats.map((s: { label: string }) => s.label)).toEqual(['L-A1', 'R-A1']);
    });
  });

  describe('losing a seat', () => {
    it('a taken seat is 409, and tells the client which seat lost (FR-HOLD-02)', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const res = await click(mina.token, eventId, seats[0]!.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'SEAT_UNAVAILABLE',
        message: 'Someone just took that seat.',
        details: { seatId: seats[0]!.id },
      });
    });

    it('leaves me no hold at all, so no timer starts on nothing', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      await click(mina.token, eventId, seats[0]!.id);
      expect((await as(mina.token).get(holdUrl(eventId))).body.hold).toBeNull();
      expect(await Hold.countDocuments({ eventId, userId: mina.user.id, status: 'active' })).toBe(
        0,
      );

      // Her next seat gets a full 10 minutes, whenever she picks it.
      const res = await click(mina.token, eventId, seats[1]!.id);
      const left = new Date(res.body.hold.expiresAt).getTime() - Date.now();
      expect(left).toBeGreaterThan(9.9 * MINUTE);
    });

    it('leaves the seats I already hold alone', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      await click(mina.token, eventId, seats[1]!.id);
      const res = await click(mina.token, eventId, seats[0]!.id);
      expect(res.status).toBe(409);
      const mine = await as(mina.token).get(holdUrl(eventId));
      expect(mine.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([seats[1]!.id]);
    });

    it('failed clicks don’t use up the limit on events held at once', async () => {
      for (let i = 0; i < HOLD.maxActiveHoldsPerUser + 1; i++) {
        const other = await makePublishedEvent(org.token);
        const rival = await registerUser(`Rival ${i}`); // a new one each time: holds have a limit too
        await click(rival.token, other.eventId, other.seats[0]!.id);
        const res = await click(mina.token, other.eventId, other.seats[0]!.id);
        expect(res.body.error.code).toBe('SEAT_UNAVAILABLE'); // never TOO_MANY_HOLDS
      }
      expect((await click(mina.token, eventId, seats[0]!.id)).status).toBe(200);
    });

    it('a blocked seat can’t be held', async () => {
      const layout = smallLayout();
      layout.sections[0]!.rows[0]!.blocked = [1] as never[];
      const ev = await makePublishedEvent(org.token, {}, layout);
      const blocked = await Seat.findOne({ eventId: ev.eventId, status: 'blocked' }).lean();
      const res = await click(rafi.token, ev.eventId, String(blocked!._id));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
    });

    it('a sold seat can’t be held', async () => {
      await Seat.updateOne({ _id: seats[0]!.id }, { $set: { status: 'booked' } });
      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
    });
  });

  describe('expiry before any cleanup runs', () => {
    it('someone else can claim a seat as soon as its hold expires (AC-HOLD-04, E4)', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const hold = await Hold.findOne({ eventId, userId: rafi.user.id }).lean();
      await setHoldExpiry(hold!._id, new Date(Date.now() - 1));

      const res = await click(mina.token, eventId, seats[0]!.id);
      expect(res.status).toBe(200);
      const seat = await Seat.findById(seats[0]!.id).lean();
      expect(String(seat!.holdId)).toBe(res.body.hold.id);
      expect(String(seat!.heldBy)).toBe(mina.user.id);
      expect(seat!.version).toBe(3);
    });

    it('the previous holder can’t release it afterwards', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const hold = await Hold.findOne({ eventId, userId: rafi.user.id }).lean();
      await setHoldExpiry(hold!._id, new Date(Date.now() - 1));
      await click(mina.token, eventId, seats[0]!.id);

      await as(rafi.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(String((await Seat.findById(seats[0]!.id).lean())!.heldBy)).toBe(mina.user.id);
    });

    it('my expired hold reads as no hold, and my next click starts a new one', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const old = await Hold.findOne({ eventId, userId: rafi.user.id }).lean();
      await setHoldExpiry(old!._id, new Date(Date.now() - 1000));
      expect((await as(rafi.token).get(holdUrl(eventId))).body.hold).toBeNull();

      const res = await click(rafi.token, eventId, seats[1]!.id);
      expect(res.status).toBe(200);
      expect(res.body.hold.id).not.toBe(String(old!._id));
      expect(res.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([seats[1]!.id]);
      expect((await Hold.findById(old!._id).lean())!.status).toBe('expired');
    });

    it('I can take back my own expired seat', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const old = await Hold.findOne({ eventId, userId: rafi.user.id }).lean();
      await setHoldExpiry(old!._id, new Date(Date.now() - 1000));
      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([seats[0]!.id]);
    });
  });

  describe('releasing', () => {
    it('frees the seat, clears the hold fields and bumps the version (FR-HOLD-07)', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      await click(rafi.token, eventId, seats[1]!.id);
      const res = await as(rafi.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(res.status).toBe(200);
      expect(res.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([seats[1]!.id]);
      expect(await Seat.findById(seats[0]!.id).lean()).toMatchObject({
        status: 'available',
        holdId: null,
        heldBy: null,
        holdExpiresAt: null,
        version: 3,
      });
    });

    it('releasing my last seat ends the hold', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const res = await as(rafi.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(res.body.hold).toBeNull();
      expect((await Hold.findOne({ eventId, userId: rafi.user.id }).lean())!.status).toBe(
        'released',
      );
    });

    it('with no hold, I can’t touch someone else’s seat', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const res = await as(mina.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(res.status).toBe(404);
      expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('held');
    });

    it('with a hold of my own, I still can’t touch someone else’s seat', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      await click(mina.token, eventId, seats[1]!.id);
      const res = await as(mina.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(res.status).toBe(200);
      expect(res.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([seats[1]!.id]);
      expect(String((await Seat.findById(seats[0]!.id).lean())!.heldBy)).toBe(rafi.user.id);
    });

    it('release all frees every seat (FR-HOLD-08)', async () => {
      for (const s of seats.slice(0, 3)) await click(rafi.token, eventId, s.id);
      const res = await as(rafi.token).delete(holdUrl(eventId));
      expect(res.status).toBe(200);
      expect(res.body.hold).toBeNull();
      expect(res.body.serverTime).toEqual(expect.any(String));
      expect(await Seat.countDocuments({ eventId, status: 'available' })).toBe(30);
      expect((await Hold.findOne({ eventId, userId: rafi.user.id }).lean())!.status).toBe(
        'released',
      );
    });

    it('release all with nothing held is 404', async () => {
      expect((await as(rafi.token).delete(holdUrl(eventId))).status).toBe(404);
    });

    it('after releasing, I can hold seats again with a fresh timer', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      const first = await Hold.findOne({ eventId, userId: rafi.user.id }).lean();
      await setHoldExpiry(first!._id, new Date(Date.now() + MINUTE));
      await as(rafi.token).delete(holdUrl(eventId));

      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.body.hold.id).not.toBe(String(first!._id));
      expect(new Date(res.body.hold.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        9.9 * MINUTE,
      );
    });
  });

  describe('a payment in progress', () => {
    const lock = async (startedAgoMs: number) => {
      await click(rafi.token, eventId, seats[0]!.id);
      await Hold.updateOne(
        { eventId, userId: rafi.user.id, status: 'active' },
        { $set: { checkoutStartedAt: new Date(Date.now() - startedAgoMs) } },
      );
    };

    it('stops seats being released one at a time', async () => {
      await lock(1000);
      const res = await as(rafi.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHECKOUT_IN_PROGRESS');
      expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('held');
    });

    it('stops release all too', async () => {
      await lock(1000);
      const res = await as(rafi.token).delete(holdUrl(eventId));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHECKOUT_IN_PROGRESS');
      expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('held');
    });

    it('shows in my hold while it’s running', async () => {
      await lock(1000);
      const mine = await as(rafi.token).get(holdUrl(eventId));
      expect(mine.body.hold.checkoutInProgress).toBe(true);
    });

    it('a lock left by a crash stops blocking the buyer (E11)', async () => {
      await lock((HOLD.checkoutLockStaleSec + 5) * 1000);
      const mine = await as(rafi.token).get(holdUrl(eventId));
      expect(mine.body.hold.checkoutInProgress).toBe(false);
      const res = await as(rafi.token).delete(holdUrl(eventId));
      expect(res.status).toBe(200);
    });
  });

  describe('which events and seats', () => {
    it('a draft is 404', async () => {
      const draft = await makeDraft(org.token);
      const res = await click(rafi.token, draft.id, seats[0]!.id);
      expect(res.status).toBe(404);
    });

    it('sales that haven’t started are 409', async () => {
      const ev = await makePublishedEvent(org.token, {
        salesStartAt: addDays(new Date(), 5).toISOString(),
      });
      const res = await click(rafi.token, ev.eventId, ev.seats[0]!.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EVENT_NOT_ON_SALE');
      expect(res.body.error.message).not.toBe('EVENT_NOT_ON_SALE'); // people read this
    });

    it('sales that have ended are 409', async () => {
      await Event.updateOne(
        { _id: eventId },
        { $set: { salesEndAt: new Date(Date.now() - MINUTE) } },
      );
      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.body.error.code).toBe('EVENT_NOT_ON_SALE');
    });

    it('a cancelled event is 404', async () => {
      await Event.updateOne({ _id: eventId }, { $set: { status: 'cancelled' } });
      expect((await click(rafi.token, eventId, seats[0]!.id)).status).toBe(404);
    });

    it('an unknown event is 404', async () => {
      const res = await click(rafi.token, new Types.ObjectId().toHexString(), seats[0]!.id);
      expect(res.status).toBe(404);
    });

    it('a seat from another event is 404, and leaves that seat and my hold alone', async () => {
      const other = await makePublishedEvent(org.token);
      const res = await click(rafi.token, eventId, other.seats[0]!.id);
      expect(res.status).toBe(404);
      expect((await Seat.findById(other.seats[0]!.id).lean())!.status).toBe('available');
      expect(await Hold.countDocuments({ userId: rafi.user.id, status: 'active' })).toBe(0);
    });

    it('a seat that doesn’t exist is 404', async () => {
      const res = await click(rafi.token, eventId, new Types.ObjectId().toHexString());
      expect(res.status).toBe(404);
    });

    it('bad IDs are 400', async () => {
      expect((await click(rafi.token, eventId, 'nope')).status).toBe(400);
      expect((await click(rafi.token, 'nope', seats[0]!.id)).status).toBe(400);
      expect((await as(rafi.token).get(holdUrl('nope'))).status).toBe(400);
      expect(
        (
          await as(rafi.token)
            .post(`${holdUrl(eventId)}/seats`)
            .send({})
        ).status,
      ).toBe(400);
    });

    it('I only ever see my own hold', async () => {
      await click(rafi.token, eventId, seats[0]!.id);
      expect((await as(mina.token).get(holdUrl(eventId))).body.hold).toBeNull();
    });
  });

  describe('holds across events (FR-HOLD-12)', () => {
    it('stops at the limit, then allows more once one is released', async () => {
      const events = [];
      for (let i = 0; i < HOLD.maxActiveHoldsPerUser; i++) {
        const ev = await makePublishedEvent(org.token);
        expect((await click(rafi.token, ev.eventId, ev.seats[0]!.id)).status).toBe(200);
        events.push(ev);
      }
      const res = await click(rafi.token, eventId, seats[0]!.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TOO_MANY_HOLDS');
      expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('available');

      await as(rafi.token).delete(holdUrl(events[0]!.eventId));
      expect((await click(rafi.token, eventId, seats[0]!.id)).status).toBe(200);
    });
  });

  describe('suspension (AC-ADM-02)', () => {
    it('frees everything the user holds, in every event', async () => {
      const admin = await makeAdmin();
      const other = await makePublishedEvent(org.token);
      for (const s of seats.slice(0, 3)) await click(rafi.token, eventId, s.id);
      await click(rafi.token, other.eventId, other.seats[0]!.id);

      const res = await as(admin.token)
        .patch(`/api/admin/users/${rafi.user.id}`)
        .send({ suspended: true, reason: 'Clicking seats with a script' });
      expect(res.status).toBe(200);

      expect(await Seat.countDocuments({ eventId, status: 'available' })).toBe(30);
      expect(await Seat.countDocuments({ eventId: other.eventId, status: 'available' })).toBe(30);
      expect(await Hold.countDocuments({ userId: rafi.user.id, status: 'active' })).toBe(0);
      expect((await Seat.findById(seats[0]!.id).lean())!.version).toBe(3);
    });

    it('leaves other buyers’ holds alone', async () => {
      const admin = await makeAdmin();
      await click(mina.token, eventId, seats[0]!.id);
      await as(admin.token)
        .patch(`/api/admin/users/${rafi.user.id}`)
        .send({ suspended: true, reason: 'Clicking seats with a script' });
      expect(String((await Seat.findById(seats[0]!.id).lean())!.heldBy)).toBe(mina.user.id);
    });
  });
});
