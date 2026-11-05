import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD, SWEEPER, newId, rowLabel } from '@seatbook/shared';
import { env } from '../src/config/env';
import { Hold, JobLock, Seat } from '../src/db/models';
import { publish } from '../src/events/publish';
import type { DomainEvent } from '../src/events/types';
import {
  INSTANCE_ID,
  isSweeperStale,
  releaseExpiredSeat,
  sweepOnce,
} from '../src/jobs/holdSweeper';
import { pMap } from '../src/lib/pMap';
import { addSeat, holdView, removeSeat } from '../src/modules/holds/hold.service';
import { makeCtx } from '../src/types/ctx';
import { app } from './setup/app';
import { publishedEventAt, makePublishedEvent } from './factories/events';
import { makeBuyers } from './helpers/buyers';
import { MIN, makeClock } from './helpers/clock';
import { makeOrganizer } from './helpers/roles';

vi.mock('../src/events/publish', async (original) => {
  const real = await original<typeof import('../src/events/publish')>();
  return { publish: vi.fn(real.publish) };
});

/** Everything the sweeper announced in its last run. */
const announced = () =>
  vi.mocked(publish).mock.calls.flatMap(([, events]) => events as DomainEvent[]);

describe('hold expiry', () => {
  let clock: ReturnType<typeof makeClock>;
  let eventId: Types.ObjectId;
  let seatId: Types.ObjectId;
  let ctxA: ReturnType<typeof makeCtx>;
  let ctxB: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    clock = makeClock(new Date().toISOString());
    const ev = await publishedEventAt(clock);
    eventId = new Types.ObjectId(ev.eventId);
    seatId = new Types.ObjectId(ev.seats[0]!.id);
    const [a, b] = await makeBuyers(2);
    ctxA = makeCtx({ userId: new Types.ObjectId(a!.user.id), role: 'attendee', now: clock.now });
    ctxB = makeCtx({ userId: new Types.ObjectId(b!.user.id), role: 'attendee', now: clock.now });
  });

  describe('lazy expiry', () => {
    it('a seat is free at exactly 10:00, not a millisecond earlier (AC-EXP-01)', async () => {
      await addSeat(ctxA, eventId, seatId);

      clock.advance(10 * MIN - 1);
      await expect(addSeat(ctxB, eventId, seatId)).rejects.toMatchObject({
        code: 'SEAT_UNAVAILABLE',
      });

      clock.advance(1); // exactly expiresAt: $lte → free
      await expect(addSeat(ctxB, eventId, seatId)).resolves.toBeTruthy();
      const seat = await Seat.findById(seatId).lean();
      expect(String(seat!.heldBy)).toBe(String(ctxB.userId));
    });

    it('my hold disappears at exactly 10:00', async () => {
      const { hold } = await addSeat(ctxA, eventId, seatId);
      const id = new Types.ObjectId(hold!.id);

      clock.advance(10 * MIN - 1);
      expect((await holdView(ctxA, id)).hold).not.toBeNull();
      clock.advance(1);
      expect((await holdView(ctxA, id)).hold).toBeNull();
    });

    it('a new click after my hold expired starts a NEW hold', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN);
      const other = await Seat.findOne({ eventId, _id: { $ne: seatId } }).lean();
      await addSeat(ctxA, eventId, other!._id);
      const holds = await Hold.find({ userId: ctxA.userId }).sort({ createdAt: 1 }).lean();
      expect(holds.map((h) => h.status)).toEqual(['expired', 'active']);
    });

    it('every seat in a hold expires together, whenever it was added (BR-03)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(9 * MIN);
      const other = await Seat.findOne({ eventId, _id: { $ne: seatId } }).lean();
      await addSeat(ctxA, eventId, other!._id); // added with 1 minute left

      clock.advance(MIN);
      await expect(addSeat(ctxB, eventId, other!._id)).resolves.toBeTruthy();
    });
  });

  describe('the sweeper', () => {
    it('releases, marks the hold expired and reports the change (AC-EXP-02)', async () => {
      await addSeat(ctxA, eventId, seatId);
      const before = await Seat.findById(seatId).lean();

      clock.advance(10 * MIN + 1_000);
      const r = await sweepOnce(clock.now(), 'test-instance');
      expect(r).toMatchObject({ skipped: false, seats: 1, holds: 1, lagMs: 1_000 });

      const after = await Seat.findById(seatId).lean();
      expect(after).toMatchObject({
        status: 'available',
        holdId: null,
        heldBy: null,
        holdExpiresAt: null,
      });
      expect(after!.version).toBe(before!.version + 1);
      expect((await Hold.findOne({ userId: ctxA.userId }).lean())!.status).toBe('expired');
      // Day 14: assert a socket client in event:<id> received seats:changed with this version
    });

    it('leaves seats alone until they expire', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN - 1);
      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 0, holds: 0 });
      expect((await Seat.findById(seatId).lean())!.status).toBe('held');
      expect((await Hold.findOne({ userId: ctxA.userId }).lean())!.status).toBe('active');
    });

    it('never releases a seat someone re-claimed after it read it (AC-EXP-03)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN + 1);
      const stale = (await Seat.findById(seatId).select('_id version').lean())!; // what the sweeper read

      await addSeat(ctxB, eventId, seatId); // B claims (lazy expiry)
      const released = await releaseExpiredSeat(stale, clock.now()); // the sweeper's write arrives late
      expect(released).toBeNull();
      expect((await Seat.findById(seatId).lean())!.status).toBe('held'); // still B's
    });

    it('a stale read never wins, even if the new hold has expired too (version CAS)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN + 1);
      const stale = (await Seat.findById(seatId).select('_id version').lean())!;
      await addSeat(ctxB, eventId, seatId);

      clock.advance(10 * MIN + 1); // a very late write: B's hold has run out as well
      expect(await releaseExpiredSeat(stale, clock.now())).toBeNull();
      expect(String((await Seat.findById(seatId).lean())!.heldBy)).toBe(String(ctxB.userId));
      // The next run reads the current version, and frees it properly.
      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 1 });
    });

    it('a seat B re-claimed before the run isn’t touched or announced as free', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN + 1);
      await addSeat(ctxB, eventId, seatId);
      vi.mocked(publish).mockClear();

      await sweepOnce(clock.now(), 'test-instance');
      expect(String((await Seat.findById(seatId).lean())!.heldBy)).toBe(String(ctxB.userId));
      expect(announced().filter((e) => e.type === 'seats.changed')).toEqual([]);
    });

    it('doesn’t release a seat in a payment window (FR-EXP-06)', async () => {
      const { hold } = await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN - 1000);
      const later = new Date(clock.now().getTime() + 2 * MIN); // what Day 16's checkout does
      await Hold.updateOne({ _id: hold!.id }, { $set: { expiresAt: later } });
      await Seat.updateOne({ _id: seatId }, { $set: { holdExpiresAt: later } });

      clock.advance(MIN);
      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 0, holds: 0 });
      expect((await Seat.findById(seatId).lean())!.status).toBe('held');
    });

    it('a window opening between read and write wins (FR-EXP-06)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN + 1);
      const stale = (await Seat.findById(seatId).select('_id version').lean())!;
      await Seat.updateOne(
        { _id: seatId },
        { $set: { holdExpiresAt: new Date(clock.now().getTime() + 2 * MIN) } },
      );
      expect(await releaseExpiredSeat(stale, clock.now())).toBeNull();
    });

    it('running twice is harmless (idempotent)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(11 * MIN);
      await sweepOnce(clock.now(), 'test-instance');
      const version = (await Seat.findById(seatId).lean())!.version;

      const second = await sweepOnce(clock.now(), 'test-instance');
      expect(second).toMatchObject({ seats: 0, holds: 0 });
      expect((await Seat.findById(seatId).lean())!.version).toBe(version);
    });

    it('announces one message per event, with no buyer identities', async () => {
      const other = await publishedEventAt(clock);
      const otherEvent = new Types.ObjectId(other.eventId);
      const otherSeats = other.seats.slice(0, 2).map((s) => new Types.ObjectId(s.id));
      await addSeat(ctxA, eventId, seatId);
      for (const s of otherSeats) await addSeat(ctxB, otherEvent, s);

      clock.advance(10 * MIN + 1);
      vi.mocked(publish).mockClear();
      await sweepOnce(clock.now(), 'test-instance');

      const seatEvents = announced().filter((e) => e.type === 'seats.changed');
      expect(seatEvents).toHaveLength(2);
      const forOther = seatEvents.find((e) => e.eventId.equals(otherEvent))!;
      expect(forOther.changes).toHaveLength(2);
      expect(forOther.changes[0]).toEqual({
        seatId: expect.any(String),
        status: 'available',
        version: 3,
        holdExpiresAt: null,
      });
      expect(JSON.stringify(seatEvents)).not.toContain(String(ctxB.userId));

      const holdEvents = announced().filter((e) => e.type === 'hold.changed');
      expect(holdEvents.map((e) => e.reason)).toEqual(['expired', 'expired']);
      expect(holdEvents.map((e) => String(e.userId)).sort()).toEqual(
        [String(ctxA.userId), String(ctxB.userId)].sort(),
      );
    });

    it('works through more than one batch, oldest first', async () => {
      const org = await makeOrganizer();
      const tier = { _id: newId(), name: 'T', price: 100, color: 'teal' as const };
      const big = await makePublishedEvent(
        org.token,
        {},
        {
          stageLabel: 'STAGE',
          tiers: [tier],
          sections: [
            {
              _id: newId(),
              name: 'Main',
              code: 'M',
              x: 0,
              y: 0,
              numbering: 'ltr',
              rows: Array.from({ length: 11 }, (_, r) => ({
                label: rowLabel(r),
                seats: 50,
                offset: 0,
                tierId: tier._id,
                gapsAfter: [],
                blocked: [],
              })),
            },
          ],
        },
      ); // 550 seats
      const past = new Date(clock.now().getTime() - 60_000);
      await Seat.updateMany(
        { eventId: big.eventId },
        { $set: { status: 'held', holdExpiresAt: past } },
      );

      const first = await sweepOnce(clock.now(), 'test-instance');
      expect(first).toMatchObject({ seats: SWEEPER.batchSize, lagMs: 60_000 });
      const second = await sweepOnce(clock.now(), 'test-instance');
      expect(second).toMatchObject({ seats: 50 });
      expect(await Seat.countDocuments({ eventId: big.eventId, status: 'available' })).toBe(550);
    });

    it('reports its lag from the oldest expired seat (FR-EXP-07)', async () => {
      const seats = await Seat.find({ eventId }).sort({ _id: 1 }).limit(2).lean();
      const now = clock.now().getTime();
      // The seat stored first is the newer one, so database order would give the wrong answer.
      await Seat.updateOne(
        { _id: seats[0]!._id },
        { $set: { status: 'held', holdExpiresAt: new Date(now - 1_000) } },
      );
      await Seat.updateOne(
        { _id: seats[1]!._id },
        { $set: { status: 'held', holdExpiresAt: new Date(now - 45_000) } },
      );
      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({
        seats: 2,
        lagMs: 45_000,
      });
    });

    it('records a heartbeat', async () => {
      await sweepOnce(clock.now(), 'test-instance');
      const lock = await JobLock.findById('hold-sweeper').lean();
      expect(lock!.lastRunAt).toEqual(clock.now());
    });
  });

  describe('when things go wrong', () => {
    it('frees seats whose hold document is already gone (E25)', async () => {
      await addSeat(ctxA, eventId, seatId);
      await Hold.deleteMany({ userId: ctxA.userId }); // what the TTL index would do
      clock.advance(70 * MIN);

      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 1, holds: 0 });
      expect((await Seat.findById(seatId).lean())!.status).toBe('available');
    });

    it('a late click left a seat on a released hold: expiry still frees it', async () => {
      const { hold } = await addSeat(ctxA, eventId, seatId);
      await Hold.updateOne({ _id: hold!.id }, { $set: { status: 'released' } });
      clock.advance(10 * MIN + 1);

      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 1, holds: 0 });
      expect((await Seat.findById(seatId).lean())!.status).toBe('available');
    });

    it('with no sweeper at all, seats are still claimable (NFR-REL-05)', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(10 * MIN);
      await expect(addSeat(ctxB, eventId, seatId)).resolves.toBeTruthy();
      expect(await JobLock.countDocuments()).toBe(0); // it really never ran
    });

    it('releasing a seat of a hold that has expired is safe', async () => {
      await addSeat(ctxA, eventId, seatId);
      clock.advance(11 * MIN);
      await removeSeat(ctxA, eventId, seatId);
      expect((await Seat.findById(seatId).lean())!.status).toBe('available');
      expect(await sweepOnce(clock.now(), 'test-instance')).toMatchObject({ seats: 0 });
    });
  });

  describe('the lease', () => {
    it('only one instance sweeps at a time', async () => {
      const now = clock.now();
      const [a, b] = await Promise.all([
        sweepOnce(now, 'instance-a'),
        sweepOnce(now, 'instance-b'),
      ]);
      expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
      // …and the other takes over once the lease runs out
      const later = new Date(now.getTime() + 31_000);
      const loser = a.skipped ? 'instance-a' : 'instance-b';
      expect((await sweepOnce(later, loser)).skipped).toBe(false);
    });

    it('an instance that lost does no work', async () => {
      await addSeat(ctxA, eventId, seatId);
      await sweepOnce(clock.now(), 'instance-a');
      clock.advance(10 * MIN);
      await JobLock.updateOne(
        { _id: 'hold-sweeper' },
        { $set: { lockedUntil: new Date(clock.now().getTime() + 30_000) } },
      );
      expect(await sweepOnce(clock.now(), 'instance-b')).toEqual({ skipped: true });
      expect((await Seat.findById(seatId).lean())!.status).toBe('held');
    });

    it('the holder renews its lease each run, so nobody else takes over', async () => {
      await sweepOnce(clock.now(), 'instance-a');
      clock.advance(20_000);
      await sweepOnce(clock.now(), 'instance-a');
      clock.advance(20_000); // 40 s after the first run, 20 s after the renewal
      expect(await sweepOnce(clock.now(), 'instance-b')).toEqual({ skipped: true });
    });
  });

  describe('/ready', () => {
    beforeEach(() => {
      env.SWEEPER_ENABLED = true;
    });
    afterEach(() => {
      env.SWEEPER_ENABLED = false;
    });

    const lockFor = (lockedBy: string, lastRunAgoMs: number) =>
      JobLock.create({
        _id: 'hold-sweeper',
        lockedBy,
        lockedUntil: new Date(Date.now() + 30_000),
        lastRunAt: new Date(Date.now() - lastRunAgoMs),
      });

    it('is fine when this instance swept recently', async () => {
      await lockFor(INSTANCE_ID, 5_000);
      expect((await request(app).get('/ready')).status).toBe(200);
    });

    it('fails when this instance holds the lock but stopped sweeping', async () => {
      await lockFor(INSTANCE_ID, 31_000);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false, reason: 'sweeper' });
    });

    it('doesn’t care about another instance’s lock', async () => {
      await lockFor('someone-else', 600_000);
      expect((await request(app).get('/ready')).status).toBe(200);
    });

    it('is fine before any sweep has run', async () => {
      expect(await isSweeperStale()).toBe(false);
    });

    it('is fine with the sweeper turned off', async () => {
      env.SWEEPER_ENABLED = false;
      await lockFor(INSTANCE_ID, 600_000);
      expect((await request(app).get('/ready')).status).toBe(200);
    });
  });

  describe('a shorter hold in development', () => {
    afterEach(() => {
      delete env.HOLD_MINUTES_OVERRIDE;
    });

    it('uses HOLD_MINUTES_OVERRIDE', async () => {
      env.HOLD_MINUTES_OVERRIDE = 1;
      const { hold } = await addSeat(ctxA, eventId, seatId);
      expect(new Date(hold!.expiresAt).getTime() - clock.now().getTime()).toBe(MIN);
    });

    it('uses the real length otherwise', async () => {
      const { hold } = await addSeat(ctxA, eventId, seatId);
      expect(new Date(hold!.expiresAt).getTime() - clock.now().getTime()).toBe(HOLD.minutes * MIN);
    });
  });
});

describe('TTL index', () => {
  it('holds have a TTL index of 1 hour on expiresAt (cleanup only)', async () => {
    const indexes = await Hold.collection.indexes();
    const ttl = indexes.find((i) => i.name === 'ttl_hold_cleanup');
    expect(ttl).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 3600 });
  });
});

describe('pMap', () => {
  it('keeps the input order, whichever finishes first', async () => {
    const out = await pMap(
      [30, 10, 20],
      async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return ms * 2;
      },
      3,
    );
    expect(out).toEqual([60, 20, 40]);
  });

  it('never runs more than the limit at once', async () => {
    let now = 0;
    let peak = 0;
    await pMap(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        peak = Math.max(peak, ++now);
        await new Promise((r) => setTimeout(r, 2));
        now -= 1;
      },
      4,
    );
    expect(peak).toBe(4);
  });

  it('handles an empty list', async () => {
    expect(await pMap([], async (x) => x, 5)).toEqual([]);
  });
});
