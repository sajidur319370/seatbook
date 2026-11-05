import { beforeEach, describe, expect, it } from 'vitest';
import { Hold, Seat } from '../src/db/models';
import { makePublishedEvent } from './factories/events';
import { as } from './helpers/auth';
import { holdUrl, makeBuyers } from './helpers/buyers';
import { makeOrganizer } from './helpers/roles';

/** The truth on the seats and the lists on the holds must tell the same story. */
async function expectConsistent(eventId: string) {
  const held = await Seat.find({ eventId, status: 'held' }).lean();
  const holds = await Hold.find({ eventId, status: 'active' }).lean();
  for (const seat of held) {
    const owners = holds.filter((h) => h.seatIds.some((id) => id.equals(seat._id)));
    expect(owners).toHaveLength(1); // exactly one hold lists it
    expect(owners[0]!._id.equals(seat.holdId!)).toBe(true); // and it's the one the seat points to
  }
  for (const h of holds) {
    expect(h.seatIds.length).toBeGreaterThan(0); // no empty hold left running
    expect(h.seatIds.length).toBe(held.filter((s) => s.holdId?.equals(h._id)).length); // no stray slot
  }
}

describe('holds under concurrency', () => {
  let eventId: string;
  let seats: { id: string; label: string }[];

  beforeEach(async () => {
    const org = await makeOrganizer();
    ({ eventId, seats } = await makePublishedEvent(org.token, { maxSeatsPerOrder: 8 })); // 30 seats
  });

  it('50 people click the same seat at once: exactly one wins (AC-HOLD-01)', async () => {
    const buyers = await makeBuyers(50);
    const seatId = seats[0]!.id;

    const results = await Promise.all(
      buyers.map((b) =>
        as(b.token)
          .post(`${holdUrl(eventId)}/seats`)
          .send({ seatId }),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(49);
    expect(lost.every((r) => r.body.error.code === 'SEAT_UNAVAILABLE')).toBe(true);

    // The database agrees: one seat, one holder, exactly one hold lists it.
    const seat = await Seat.findById(seatId).lean();
    expect(seat!.status).toBe('held');
    expect(seat!.version).toBe(2);
    expect(await Hold.countDocuments({ seatIds: seat!._id })).toBe(1);
    // Losers' slots were given back (compensation): nobody else has a non-empty hold.
    expect(await Hold.countDocuments({ eventId, 'seatIds.0': { $exists: true } })).toBe(1);
    // And the 49 losers aren't left with a timer running on nothing.
    expect(await Hold.countDocuments({ eventId, status: 'active' })).toBe(1);
    await expectConsistent(eventId);
  }, 60_000);

  it('one user, 12 parallel clicks, limit 8: exactly 8 held (AC-HOLD-02)', async () => {
    const [rafi] = await makeBuyers(1);
    const results = await Promise.all(
      seats.slice(0, 12).map((s) =>
        as(rafi!.token)
          .post(`${holdUrl(eventId)}/seats`)
          .send({ seatId: s.id }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(8);
    expect(
      results.filter((r) => r.status === 409 && r.body.error.code === 'HOLD_LIMIT'),
    ).toHaveLength(4);

    const holds = await Hold.find({ eventId, status: 'active' }).lean();
    expect(holds).toHaveLength(1); // AC-HOLD-03 for free: one hold
    expect(holds[0]!.seatIds).toHaveLength(8);
    expect(await Seat.countDocuments({ eventId, status: 'held' })).toBe(8);
    expect(await Seat.countDocuments({ eventId, status: 'available' })).toBe(22);
    await expectConsistent(eventId);
  });

  it('two tabs: first click in both at once → one hold with both seats (AC-HOLD-03)', async () => {
    const [rafi] = await makeBuyers(1);
    const [a, b] = await Promise.all([
      as(rafi!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: seats[0]!.id }),
      as(rafi!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: seats[1]!.id }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const holds = await Hold.find({ eventId, userId: rafi!.user.id }).lean();
    expect(holds).toHaveLength(1);
    expect(holds[0]!.seatIds.map(String).sort()).toEqual([seats[0]!.id, seats[1]!.id].sort());
  });

  it('five clicks on one seat at once count once (E3)', async () => {
    const [rafi] = await makeBuyers(1);
    const seatId = seats[0]!.id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        as(rafi!.token)
          .post(`${holdUrl(eventId)}/seats`)
          .send({ seatId }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const seat = await Seat.findById(seatId).lean();
    expect(seat!.version).toBe(2); // claimed once
    expect((await Hold.findOne({ eventId, status: 'active' }).lean())!.seatIds).toHaveLength(1);
  });

  it('a crowd on a few seats: every seat ends with one holder', async () => {
    const buyers = await makeBuyers(20);
    const contested = seats.slice(0, 5);
    const results = await Promise.all(
      buyers.flatMap((b) =>
        contested.map((s) =>
          as(b.token)
            .post(`${holdUrl(eventId)}/seats`)
            .send({ seatId: s.id }),
        ),
      ),
    );
    expect(results.every((r) => [200, 409, 410].includes(r.status))).toBe(true); // never a 500
    expect(await Seat.countDocuments({ eventId, status: 'held' })).toBe(5);
    await expectConsistent(eventId);
  }, 60_000);

  it('a user’s losing click never takes away a seat they won', async () => {
    const [rafi, rival] = await makeBuyers(2);
    const taken = seats.slice(0, 5);
    for (const s of taken) {
      await as(rival!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: s.id });
    }
    const free = seats[10]!;
    const results = await Promise.all([
      ...taken.map((s) =>
        as(rafi!.token)
          .post(`${holdUrl(eventId)}/seats`)
          .send({ seatId: s.id }),
      ),
      as(rafi!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: free.id }),
    ]);
    expect(results.slice(0, 5).every((r) => r.status === 409)).toBe(true);
    // Rare but allowed: losing clicks retired the empty hold under it, so the client retries once.
    const last = results[5]!;
    expect([200, 410]).toContain(last.status);
    if (last.status === 410) {
      const retry = await as(rafi!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: free.id });
      expect(retry.status).toBe(200);
    }
    const mine = await as(rafi!.token).get(holdUrl(eventId));
    expect(mine.body.hold.seats.map((s: { id: string }) => s.id)).toEqual([free.id]);
    await expectConsistent(eventId);
  });

  it('releasing and clicking at once leaves the books straight', async () => {
    const [rafi] = await makeBuyers(1);
    for (const s of seats.slice(0, 4)) {
      await as(rafi!.token)
        .post(`${holdUrl(eventId)}/seats`)
        .send({ seatId: s.id });
    }
    const results = await Promise.all([
      ...seats.slice(0, 4).map((s) => as(rafi!.token).delete(`${holdUrl(eventId)}/seats/${s.id}`)),
      ...seats.slice(4, 8).map((s) =>
        as(rafi!.token)
          .post(`${holdUrl(eventId)}/seats`)
          .send({ seatId: s.id }),
      ),
    ]);
    expect(results.every((r) => [200, 404, 410].includes(r.status))).toBe(true);
    await expectConsistent(eventId);
  });
});
