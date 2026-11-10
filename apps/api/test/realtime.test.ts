import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io-client';
import { Event, Seat, User } from '../src/db/models';
import { sweepOnce } from '../src/jobs/holdSweeper';
import { publish } from '../src/events/publish';
import { oid } from '../src/lib/ids';
import { getIO } from '../src/realtime/socket';
import { systemCtx } from '../src/types/ctx';
import { as } from './helpers/auth';
import { holdUrl, makeBuyers } from './helpers/buyers';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import {
  collect,
  connect,
  emitAck,
  expectNoEvent,
  nextEvent,
  startServer,
} from './helpers/sockets';
import { makeDraft, makePublishedEvent } from './factories/events';
import { holdSeats, pay } from './helpers/checkout';

const elevenMinutesLater = () => new Date(Date.now() + 11 * 60_000);

let srv: Awaited<ReturnType<typeof startServer>>;
const open: Socket[] = [];
const socketFor = async (token: string) => {
  const s = await connect(srv.port, token);
  open.push(s);
  return s;
};
/** A viewer with the event's map open. */
const viewerOf = async (token: string, eventId: string) => {
  const s = await socketFor(token);
  expect(await emitAck(s, 'event:join', { eventId })).toEqual({ ok: true });
  return s;
};

beforeAll(async () => {
  srv = await startServer();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of open.splice(0)) s.disconnect();
});
afterAll(async () => {
  await srv.close();
});

describe('realtime', () => {
  let eventId: string;
  let seats: { id: string }[];
  let org: Awaited<ReturnType<typeof makeOrganizer>>;
  const hold = (token: string, i = 0, mutationId = 'cm-test') =>
    as(token)
      .post(`${holdUrl(eventId)}/seats`)
      .set('X-Client-Mutation-Id', mutationId)
      .send({ seatId: seats[i]!.id });

  beforeEach(async () => {
    org = await makeOrganizer();
    ({ eventId, seats } = await makePublishedEvent(org.token));
  });

  describe('handshake (FR-RT-01)', () => {
    it.each([
      ['a bad token', 'nope', 'UNAUTHENTICATED'],
      ['no token', '', 'UNAUTHENTICATED'],
    ])('rejects %s', async (_name, token, code) => {
      await expect(connect(srv.port, token)).rejects.toThrow(code);
    });

    it('says when a token expired, so the client knows to refresh', async () => {
      const [rafi] = await makeBuyers(1);
      const old = jwt.sign({ sid: 'x' }, process.env.JWT_ACCESS_SECRET!, {
        subject: rafi!.user.id,
        expiresIn: -10,
      });
      await expect(connect(srv.port, old)).rejects.toThrow('TOKEN_EXPIRED');
    });

    it('rejects a user who no longer exists', async () => {
      const [rafi] = await makeBuyers(1);
      await User.deleteOne({ _id: rafi!.user.id });
      await expect(connect(srv.port, rafi!.token)).rejects.toThrow('UNAUTHENTICATED');
    });

    it("a database failure isn't reported as a bad login", async () => {
      const [rafi] = await makeBuyers(1);
      vi.spyOn(User, 'findById').mockImplementationOnce(() => {
        throw new Error('db down');
      });
      await expect(connect(srv.port, rafi!.token)).rejects.toThrow('INTERNAL_ERROR');
    });
  });

  describe('joining rooms', () => {
    it("can't join another organizer's draft or staff room (AC-RT-02)", async () => {
      const other = await makeOrganizer('Other');
      const draft = await makeDraft(other.token);
      const [rafi] = await makeBuyers(1);
      const s = await socketFor(rafi!.token);
      expect(await emitAck(s, 'event:join', { eventId: draft.id })).toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(await emitAck(s, 'staff:join', { eventId })).toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    });

    it('its own organizer and an admin can join a draft', async () => {
      const draft = await makeDraft(org.token);
      const admin = await makeAdmin();
      for (const token of [org.token, admin.token]) {
        const s = await socketFor(token);
        expect(await emitAck(s, 'event:join', { eventId: draft.id })).toEqual({ ok: true });
      }
    });

    it('the owner and an admin can join the staff room', async () => {
      const admin = await makeAdmin();
      for (const token of [org.token, admin.token]) {
        const s = await socketFor(token);
        expect(await emitAck(s, 'staff:join', { eventId })).toEqual({ ok: true });
      }
    });

    it.each([
      ['a bad id', { eventId: 'nope' }],
      ['an injection attempt', { eventId: { $ne: null } }],
      ['nothing', null],
    ])('rejects %s', async (_name, payload) => {
      const [rafi] = await makeBuyers(1);
      const s = await socketFor(rafi!.token);
      expect(await emitAck(s, 'event:join', payload)).toEqual({
        ok: false,
        code: 'VALIDATION_ERROR',
      });
      expect(await emitAck(s, 'staff:join', payload)).toEqual({
        ok: false,
        code: 'VALIDATION_ERROR',
      });
    });

    it("a join with no callback doesn't crash the server", async () => {
      const [rafi] = await makeBuyers(1);
      const s = await socketFor(rafi!.token);
      s.emit('event:join', { eventId: 'nope' });
      s.emit('event:join', { eventId });
      await new Promise((r) => setTimeout(r, 100));
      expect(await emitAck(s, 'event:join', { eventId })).toEqual({ ok: true });
    });

    it.each(['event:join', 'staff:join'])(
      '%s answers with an error when the database fails, and the server survives',
      async (name) => {
        const [rafi] = await makeBuyers(1);
        const s = await socketFor(rafi!.token);
        vi.spyOn(Event, 'exists').mockImplementationOnce(() => {
          throw new Error('db down');
        });
        expect(await emitAck(s, name, { eventId })).toEqual({
          ok: false,
          code: 'INTERNAL_ERROR',
        });
        expect(await emitAck(s, 'event:join', { eventId })).toEqual({ ok: true });
      },
    );

    it('one map at a time: joining another leaves the first', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const second = (await makePublishedEvent(org.token)).eventId;
      const s = await viewerOf(mina!.token, eventId);
      expect(await emitAck(s, 'event:join', { eventId: second })).toEqual({ ok: true });
      const silence = expectNoEvent(s, 'seats:changed');
      await hold(rafi!.token);
      await silence;
    });

    it('a slow join can’t undo a later one, or a leave', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const second = await makePublishedEvent(org.token);
      const slowly = () => {
        const real = Event.exists.bind(Event);
        vi.spyOn(Event, 'exists').mockImplementationOnce(((filter: never) =>
          new Promise((r) => setTimeout(r, 150)).then(() => real(filter))) as never);
      };

      const s = await socketFor(mina!.token);
      slowly();
      const first = emitAck(s, 'event:join', { eventId });
      await emitAck(s, 'event:join', { eventId: second.eventId });
      await first;
      const silence = expectNoEvent(s, 'seats:changed');
      await hold(rafi!.token);
      await silence;
      const heard = nextEvent(s, 'seats:changed');
      await as(rafi!.token)
        .post(`${holdUrl(second.eventId)}/seats`)
        .send({ seatId: second.seats[0]!.id });
      await heard;

      const t = await socketFor(mina!.token);
      slowly();
      const joining = emitAck(t, 'event:join', { eventId });
      t.emit('event:leave', { eventId });
      await joining;
      const quiet = expectNoEvent(t, 'seats:changed');
      await hold(rafi!.token, 1);
      await quiet;
    });

    it('event:leave stops the messages', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const s = await viewerOf(mina!.token, eventId);
      s.emit('event:leave', { eventId });
      await new Promise((r) => setTimeout(r, 100));
      const silence = expectNoEvent(s, 'seats:changed');
      await hold(rafi!.token);
      await silence;
    });

    it('viewers of another event hear nothing', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const other = (await makePublishedEvent(org.token)).eventId;
      const s = await viewerOf(mina!.token, other);
      const silence = expectNoEvent(s, 'seats:changed');
      await hold(rafi!.token);
      await silence;
    });
  });

  describe('seats:changed', () => {
    it('a hold reaches other viewers, with a version and no identity (AC-RT-03)', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const viewer = await viewerOf(mina!.token, eventId);

      const got = nextEvent<{ changes: Record<string, unknown>[]; clientMutationId: string }>(
        viewer,
        'seats:changed',
      );
      await hold(rafi!.token, 0, 'cm-1');
      const msg = await got;

      expect(msg.changes).toEqual([
        { seatId: seats[0]!.id, status: 'held', version: 2, holdExpiresAt: expect.any(String) },
      ]);
      expect(msg.clientMutationId).toBe('cm-1'); // FR-RT-09: the clicking tab ignores its own echo
      const json = JSON.stringify(msg);
      expect(json).not.toContain(rafi!.user.id); // NFR-PRIV-02
      expect(json).not.toMatch(/heldBy|holdId|userId|email|name/);
    });

    it('is sent only after the write (FR-RT-06)', async () => {
      const [rafi, mina] = await makeBuyers(2);
      const viewer = await viewerOf(mina!.token, eventId);
      let seen: { status?: string; version?: number } | null = null;
      viewer.once('seats:changed', () => {
        void Seat.findById(seats[0]!.id)
          .lean()
          .then((s) => {
            seen = s;
          });
      });
      await hold(rafi!.token);
      await vi.waitFor(() => expect(seen).toMatchObject({ status: 'held', version: 2 }));
    });

    it('a release turns the seat back, with a higher version', async () => {
      const [rafi, mina] = await makeBuyers(2);
      await hold(rafi!.token);
      const viewer = await viewerOf(mina!.token, eventId);
      const got = nextEvent<{ changes: unknown[] }>(viewer, 'seats:changed');
      await as(rafi!.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect((await got).changes).toEqual([
        { seatId: seats[0]!.id, status: 'available', version: 3, holdExpiresAt: null },
      ]);
    });

    it('releasing everything is one message, not one per seat', async () => {
      const [rafi, mina] = await makeBuyers(2);
      for (const i of [0, 1, 2]) await hold(rafi!.token, i);
      const viewer = await viewerOf(mina!.token, eventId);
      const messages = collect<{ changes: unknown[] }>(viewer, 'seats:changed');
      await as(rafi!.token).delete(holdUrl(eventId));
      const got = await messages;
      expect(got).toHaveLength(1);
      expect(got[0]!.changes).toHaveLength(3);
    });

    it('each write answers with what it did, version included', async () => {
      const [rafi] = await makeBuyers(1);
      const added = await hold(rafi!.token);
      expect(added.body.changes).toEqual([
        { seatId: seats[0]!.id, status: 'held', version: 2, holdExpiresAt: expect.any(String) },
      ]);
      const removed = await as(rafi!.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect(removed.body.changes).toEqual([
        { seatId: seats[0]!.id, status: 'available', version: 3, holdExpiresAt: null },
      ]);
      await hold(rafi!.token, 1);
      await hold(rafi!.token, 2);
      const all = await as(rafi!.token).delete(holdUrl(eventId));
      expect(all.body.changes).toHaveLength(2);
      expect((await as(rafi!.token).get(holdUrl(eventId))).body).not.toHaveProperty('changes');
    });

    it("a failed click sends nothing: the seat didn't change", async () => {
      const [rafi, mina, sam] = await makeBuyers(3);
      await hold(rafi!.token);
      const viewer = await viewerOf(sam!.token, eventId);
      const silence = expectNoEvent(viewer, 'seats:changed');
      expect((await hold(mina!.token)).status).toBe(409);
      await silence;
    });

    it("a failed broadcast doesn't fail the request", async () => {
      const [rafi] = await makeBuyers(1);
      vi.spyOn(getIO()!, 'to').mockImplementation(() => {
        throw new Error('socket trouble');
      });
      const res = await hold(rafi!.token);
      expect(res.status).toBe(200);
      expect(res.body.hold.seats).toHaveLength(1);
    });
  });

  describe('the sweeper', () => {
    it('broadcasts released seats (completes AC-EXP-02)', async () => {
      const [rafi, mina] = await makeBuyers(2);
      await hold(rafi!.token);
      const viewer = await viewerOf(mina!.token, eventId);
      const got = nextEvent<{ changes: { status: string; version: number }[] }>(
        viewer,
        'seats:changed',
      );
      await sweepOnce(elevenMinutesLater(), 'test');
      expect((await got).changes[0]).toMatchObject({ status: 'available', version: 3 });
    });

    it('frees many seats in one message per event', async () => {
      const [rafi, mina, sam] = await makeBuyers(3);
      for (const i of [0, 1, 2]) await hold(rafi!.token, i);
      const second = await makePublishedEvent(org.token);
      await as(mina!.token)
        .post(`${holdUrl(second.eventId)}/seats`)
        .send({ seatId: second.seats[0]!.id });

      const here = await viewerOf(sam!.token, eventId);
      const there = await viewerOf(rafi!.token, second.eventId);
      const [a, b] = [
        collect<{ eventId: string; changes: unknown[] }>(here, 'seats:changed'),
        collect<{ eventId: string; changes: unknown[] }>(there, 'seats:changed'),
      ];
      await sweepOnce(elevenMinutesLater(), 'test');
      const [gotA, gotB] = await Promise.all([a, b]);
      expect(gotA.map((m) => m.changes.length)).toEqual([3]);
      expect(gotB.map((m) => m.changes.length)).toEqual([1]);
    });

    it("tells the buyer's tabs the hold is gone", async () => {
      const [rafi] = await makeBuyers(1);
      await hold(rafi!.token);
      const tab = await socketFor(rafi!.token);
      const got = nextEvent<{ hold: unknown; reason: string }>(tab, 'hold:changed');
      await sweepOnce(elevenMinutesLater(), 'test');
      expect(await got).toMatchObject({ hold: null, reason: 'expired' });
    });
  });

  describe('hold:changed (FR-RT-10)', () => {
    it('my other tab gets the hold, and the server time', async () => {
      const [rafi] = await makeBuyers(1);
      const tab2 = await socketFor(rafi!.token); // joined user:<id> automatically
      const got = nextEvent<{
        hold: { seats: unknown[] };
        reason: string;
        serverTime: string;
        clientMutationId: string;
      }>(tab2, 'hold:changed');
      await hold(rafi!.token, 0, 'cm-2');
      const msg = await got;
      expect(msg.hold.seats).toHaveLength(1);
      expect(msg.reason).toBe('seat_added');
      expect(Date.parse(msg.serverTime)).toBeGreaterThan(0);
      expect(msg.clientMutationId).toBe('cm-2');
    });

    it('removing the last seat sends no hold', async () => {
      const [rafi] = await makeBuyers(1);
      await hold(rafi!.token);
      const tab = await socketFor(rafi!.token);
      const got = nextEvent<{ hold: unknown }>(tab, 'hold:changed');
      await as(rafi!.token).delete(`${holdUrl(eventId)}/seats/${seats[0]!.id}`);
      expect((await got).hold).toBeNull();
    });

    it("an old hold's expiry doesn't wipe a new one", async () => {
      const [rafi] = await makeBuyers(1);
      await hold(rafi!.token); // a live hold, while the message about an older one is on its way
      const tab = await socketFor(rafi!.token);
      const got = nextEvent<{ hold: { seats: unknown[] } | null; reason: string }>(
        tab,
        'hold:changed',
      );
      await publish(systemCtx(), [
        {
          type: 'hold.changed',
          userId: oid(rafi!.user.id),
          eventId: oid(eventId),
          reason: 'expired',
        },
      ]);
      const msg = await got;
      expect(msg.reason).toBe('expired');
      expect(msg.hold?.seats).toHaveLength(1);
    });

    it("another buyer's tabs hear nothing about it", async () => {
      const [rafi, mina] = await makeBuyers(2);
      const tab = await socketFor(mina!.token);
      const silence = expectNoEvent(tab, 'hold:changed');
      await hold(rafi!.token);
      await silence;
    });
  });

  describe('event:updated', () => {
    const edit = (patch: Record<string, unknown>, revision: number, id = eventId) =>
      as(org.token)
        .patch(`/api/organizer/events/${id}`)
        .send({ ...patch, expectedRevision: revision });
    const revision = async (id = eventId) =>
      (await Event.findOne({ _id: id }).select('revision').lean())!.revision;

    it('an edit reaches viewers, without the seat map or private fields', async () => {
      const [mina] = await makeBuyers(1);
      const viewer = await viewerOf(mina!.token, eventId);
      const got = nextEvent<{ event: Record<string, unknown> }>(viewer, 'event:updated');
      expect((await edit({ title: 'A New Title' }, await revision())).status).toBe(200);
      const { event } = await got;
      expect(event).toMatchObject({ id: eventId, title: 'A New Title', phase: 'on_sale' });
      for (const k of ['seatMap', 'counters', 'organizerId', 'status', 'revision'])
        expect(event).not.toHaveProperty(k);
    });

    it('unpublishing tells viewers and every holder (E13)', async () => {
      const [rafi, mina] = await makeBuyers(2);
      await hold(rafi!.token);
      const viewer = await viewerOf(mina!.token, eventId);
      const tab = await socketFor(rafi!.token);
      const updated = nextEvent<{ event: { phase: string } }>(viewer, 'event:updated');
      const holdGone = nextEvent<{ hold: unknown; reason: string }>(tab, 'hold:changed');
      expect((await as(org.token).post(`/api/organizer/events/${eventId}/unpublish`)).status).toBe(
        200,
      );
      expect((await updated).event.phase).toBe('draft');
      expect(await holdGone).toMatchObject({ hold: null, reason: 'released' });
    });

    it("a viewer can't follow an event once it's a private draft again", async () => {
      const [mina] = await makeBuyers(1);
      const admin = await makeAdmin();
      const viewer = await viewerOf(mina!.token, eventId);
      const owner = await viewerOf(org.token, eventId);
      const adminSocket = await viewerOf(admin.token, eventId);
      const told = nextEvent(viewer, 'event:updated');
      await as(org.token).post(`/api/organizer/events/${eventId}/unpublish`);
      await told; // still told that it closed

      const silence = expectNoEvent(viewer, 'event:updated');
      const ownerHears = nextEvent<{ event: { title: string } }>(owner, 'event:updated');
      const adminHears = nextEvent<{ event: { title: string } }>(adminSocket, 'event:updated');
      await edit({ title: 'Secret Draft Title' }, await revision());
      await silence;
      expect((await ownerHears).event.title).toBe('Secret Draft Title');
      expect((await adminHears).event.title).toBe('Secret Draft Title');
    });
  });

  describe('account:changed (FR-RT-13)', () => {
    const application = {
      organizationName: 'Dhaka Live',
      message: 'We run live shows across Dhaka all year round.',
    };

    it('a suspended user is told, then disconnected, and can’t come back', async () => {
      const admin = await makeAdmin();
      const [bot] = await makeBuyers(1);
      const s = await socketFor(bot!.token);
      const closed = new Promise((r) => s.once('disconnect', r));
      const changed = nextEvent(s, 'account:changed');
      await as(admin.token)
        .patch(`/api/admin/users/${bot!.user.id}`)
        .send({ suspended: true, reason: 'bot activity' });
      expect(await changed).toEqual({ role: 'attendee', suspended: true });
      await closed;
      await expect(connect(srv.port, bot!.token)).rejects.toThrow('ACCOUNT_SUSPENDED');
    });

    it("a suspended buyer's seats are free before their socket is cut (AC-ADM-02)", async () => {
      const admin = await makeAdmin();
      const [bot, mina] = await makeBuyers(2);
      for (const i of [0, 1, 2]) await hold(bot!.token, i);
      const viewer = await viewerOf(mina!.token, eventId);
      const messages = collect<{ changes: { status: string }[] }>(viewer, 'seats:changed');
      await as(admin.token)
        .patch(`/api/admin/users/${bot!.user.id}`)
        .send({ suspended: true, reason: 'bot activity' });
      const got = await messages;
      expect(got).toHaveLength(1);
      expect(got[0]!.changes.map((c) => c.status)).toEqual(['available', 'available', 'available']);
    });

    it('a role change reaches the user', async () => {
      const admin = await makeAdmin();
      const [rafi] = await makeBuyers(1);
      const s = await socketFor(rafi!.token);
      const changed = nextEvent(s, 'account:changed');
      await as(admin.token).patch(`/api/admin/users/${rafi!.user.id}`).send({ role: 'organizer' });
      expect(await changed).toEqual({ role: 'organizer', suspended: false });
    });

    it('approval makes them an organizer, right away', async () => {
      const admin = await makeAdmin();
      const [rafi] = await makeBuyers(1);
      const app = await as(rafi!.token).post('/api/organizer-applications').send(application);
      expect(app.status).toBe(201);
      const s = await socketFor(rafi!.token);
      const changed = nextEvent(s, 'account:changed');
      await as(admin.token).post(
        `/api/admin/organizer-applications/${app.body.application.id}/approve`,
      );
      expect(await changed).toEqual({
        role: 'organizer',
        suspended: false,
        application: { status: 'approved' },
      });
    });

    it('a rejection is sent too, and the role stays', async () => {
      const admin = await makeAdmin();
      const [rafi] = await makeBuyers(1);
      const app = await as(rafi!.token).post('/api/organizer-applications').send(application);
      const s = await socketFor(rafi!.token);
      const changed = nextEvent(s, 'account:changed');
      await as(admin.token)
        .post(`/api/admin/organizer-applications/${app.body.application.id}/reject`)
        .send({ reason: 'Please add a website for your company.' });
      expect(await changed).toEqual({
        role: 'attendee',
        suspended: false,
        application: { status: 'rejected' },
      });
    });
  });

  describe('checkout (Day 16)', () => {
    it('a purchase reaches the map, the buyer’s tabs and the staff room', async () => {
      const [rafi, mina] = await makeBuyers(2);
      await holdSeats(rafi!.token, eventId, [seats[0]!.id, seats[1]!.id]);

      const viewer = await viewerOf(mina!.token, eventId);
      const tab2 = await socketFor(rafi!.token);
      const staff = await socketFor(org.token);
      expect(await emitAck(staff, 'staff:join', { eventId })).toEqual({ ok: true });

      const maps: {
        changes: { seatId: string; status: string; holdExpiresAt: string | null }[];
      }[] = [];
      viewer.on('seats:changed', (m) => maps.push(m));
      const confirmed = nextEvent<{ eventId: string; bookingId: string }>(
        tab2,
        'booking:confirmed',
      );
      const sales = nextEvent(staff, 'sales:updated');

      const res = await pay(rafi!.token, eventId);
      expect(res.status).toBe(201);
      expect(await confirmed).toEqual({ eventId, bookingId: res.body.booking.id });
      expect(await sales).toEqual({ eventId, seatsSold: 2, revenue: 8000 });

      // First the payment window (still held, later expiry), then booked.
      expect(maps).toHaveLength(2);
      expect(maps[0]!.changes.map((c) => c.status)).toEqual(['held', 'held']);
      expect(maps[1]!.changes).toEqual([
        expect.objectContaining({ status: 'booked', holdExpiresAt: null }),
        expect.objectContaining({ status: 'booked', holdExpiresAt: null }),
      ]);
      expect(JSON.stringify(maps)).not.toContain(rafi!.user.id); // NFR-PRIV-02
    });

    it('other buyers don’t get the booking, and viewers don’t get sales', async () => {
      const [rafi, mina] = await makeBuyers(2);
      await holdSeats(rafi!.token, eventId, [seats[0]!.id]);
      const other = await viewerOf(mina!.token, eventId);
      expect((await pay(rafi!.token, eventId)).status).toBe(201);
      await expectNoEvent(other, 'booking:confirmed');
      await expectNoEvent(other, 'sales:updated');
    });
  });

  it('clients can’t write over the socket (FR-RT-05)', async () => {
    const [rafi] = await makeBuyers(1);
    const s = await socketFor(rafi!.token);
    s.emit('hold:add', { eventId, seatId: seats[0]!.id });
    s.emit('seats:changed', { eventId, changes: [{ seatId: seats[0]!.id, status: 'booked' }] });
    await new Promise((r) => setTimeout(r, 150));
    expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('available');
  });
});
