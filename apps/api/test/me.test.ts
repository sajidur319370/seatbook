import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MANUAL_CODE } from '@seatbook/shared';
import { Booking, Ticket } from '../src/db/models';
import { manualCode, qrCode } from '../src/lib/ticketCodes';
import { app } from './setup/app';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import { makePublishedEvent } from './factories/events';

type Buyer = Awaited<ReturnType<typeof makeBuyers>>[number];

describe('my bookings and tickets', () => {
  let eventId: string;
  let rafi: Buyer;
  let mina: Buyer;
  let bookingId: string;
  let ticketIds: string[];

  beforeEach(async () => {
    const org = await makeOrganizer();
    const ev = await makePublishedEvent(org.token);
    eventId = ev.eventId;
    [rafi, mina] = (await makeBuyers(2)) as [Buyer, Buyer];
    await holdSeats(rafi.token, eventId, [ev.seats[0]!.id, ev.seats[1]!.id]);
    const res = await pay(rafi.token, eventId);
    expect(res.status).toBe(201);
    bookingId = res.body.booking.id;
    ticketIds = res.body.booking.tickets.map((t: { id: string }) => t.id);
  });

  /** Every code this booking's tickets have: none may appear in a list or a log (FR-TKT-09). */
  async function allCodes() {
    const tickets = await Ticket.find({ bookingId }).lean();
    return tickets.flatMap((t) => [qrCode(t._id, t.eventId), manualCode(t._id)]);
  }

  describe('GET /me/bookings (FR-TKT-04)', () => {
    it('lists mine, newest first, without codes', async () => {
      const res = await as(rafi.token).get('/api/me/bookings');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id: bookingId,
        reference: expect.stringMatching(/^SB-/),
        seats: 2,
        total: 8000,
        event: { id: eventId, title: expect.any(String), timezone: 'Asia/Dhaka' },
      });
      expect(res.body.nextCursor).toBeNull();
      const json = JSON.stringify(res.body);
      for (const code of await allCodes()) expect(json).not.toContain(code);
    });

    it('someone else sees an empty list', async () => {
      const res = await as(mina.token).get('/api/me/bookings');
      expect(res.body.items).toEqual([]);
    });

    it('pages with a cursor, 20 at a time, with no gaps or repeats', async () => {
      const b = (await Booking.findById(bookingId).lean())!;
      const copy: Partial<typeof b> = { ...b };
      delete copy._id;
      // 24 more, some in the same millisecond, so the _id tie-breaker matters.
      // The raw collection, so Mongoose's timestamps don't overwrite these createdAt values.
      await Booking.collection.insertMany(
        Array.from({ length: 24 }, (_, i) => ({
          ...copy,
          _id: new Types.ObjectId(),
          reference: `SB-TEST-${String(i).padStart(4, '0')}`,
          holdId: new Types.ObjectId(),
          idempotencyKey: `key-${i}`,
          createdAt: new Date(b.createdAt.getTime() - Math.floor(i / 3) * 1000),
        })),
      );

      const first = await as(rafi.token).get('/api/me/bookings');
      expect(first.body.items).toHaveLength(20);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await as(rafi.token).get(
        `/api/me/bookings?cursor=${encodeURIComponent(first.body.nextCursor)}`,
      );
      expect(second.body.items).toHaveLength(5);
      expect(second.body.nextCursor).toBeNull();

      const ids = [...first.body.items, ...second.body.items].map((x: { id: string }) => x.id);
      expect(new Set(ids).size).toBe(25);
      const times = [...first.body.items, ...second.body.items].map((x: { createdAt: string }) =>
        Date.parse(x.createdAt),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('a broken cursor is a 400, not a 500', async () => {
      const res = await as(rafi.token).get('/api/me/bookings?cursor=nope');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /me/bookings/:id', () => {
    it('returns the booking with its tickets, and no codes', async () => {
      const res = await as(rafi.token).get(`/api/me/bookings/${bookingId}`);
      expect(res.status).toBe(200);
      expect(res.body.booking.tickets).toHaveLength(2);
      expect(res.body.booking.payment).toEqual({
        brand: 'visa',
        last4: '4242',
        paidAt: expect.any(String),
      });
      const json = JSON.stringify(res.body);
      for (const code of await allCodes()) expect(json).not.toContain(code);
      expect(json).not.toMatch(/chargeId|manualCodeHash|idempotencyKey/);
    });
  });

  describe('GET /me/tickets (FR-TKT-05)', () => {
    it('groups upcoming tickets by event, without codes', async () => {
      const res = await as(rafi.token).get('/api/me/tickets?when=upcoming');
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].event).toMatchObject({
        id: eventId,
        venueName: expect.any(String),
      });
      expect(res.body.groups[0].tickets.map((t: { id: string }) => t.id).sort()).toEqual(
        [...ticketIds].sort(),
      );
      const json = JSON.stringify(res.body);
      expect(json).not.toMatch(/qrDataUrl|manualCode/);
      for (const code of await allCodes()) expect(json).not.toContain(code);
    });

    it('"upcoming" is the default; a show that started 7 h ago is "past"', async () => {
      expect((await as(rafi.token).get('/api/me/tickets')).body.groups).toHaveLength(1);
      await Ticket.updateMany(
        { bookingId },
        { $set: { eventStartsAt: new Date(Date.now() - 7 * 3_600_000) } },
      );
      expect((await as(rafi.token).get('/api/me/tickets')).body.groups).toEqual([]);
      const past = await as(rafi.token).get('/api/me/tickets?when=past');
      expect(past.body.groups[0].tickets).toHaveLength(2);
    });

    it('a show that started 5 h ago is still "upcoming" (it may still be on)', async () => {
      await Ticket.updateMany(
        { bookingId },
        { $set: { eventStartsAt: new Date(Date.now() - 5 * 3_600_000) } },
      );
      expect((await as(rafi.token).get('/api/me/tickets')).body.groups).toHaveLength(1);
    });

    it('void tickets are left out', async () => {
      await Ticket.updateMany({ bookingId }, { $set: { status: 'void', seatKey: null } });
      expect((await as(rafi.token).get('/api/me/tickets')).body.groups).toEqual([]);
    });

    it('rejects an unknown "when"', async () => {
      expect((await as(rafi.token).get('/api/me/tickets?when=soon')).status).toBe(400);
    });
  });

  describe('GET /me/tickets/:id (FR-TKT-06)', () => {
    it('has the QR as a PNG data URL and the manual code, and is never cached', async () => {
      const res = await as(rafi.token).get(`/api/me/tickets/${ticketIds[0]}`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(res.body.manualCode.replace(/-/g, '')).toMatch(MANUAL_CODE);
      expect(res.body.ticket).toMatchObject({
        id: ticketIds[0],
        bookingId,
        eventId,
        status: 'issued',
        holderName: rafi.user.name,
      });
      expect(res.body.event).toMatchObject({ id: eventId, timezone: 'Asia/Dhaka' });
      // The raw QR string is only inside the image.
      const t = (await Ticket.findById(ticketIds[0]).lean())!;
      expect(JSON.stringify(res.body)).not.toContain(qrCode(t._id, t.eventId));
    });

    it('a void ticket has no codes', async () => {
      await Ticket.updateOne({ _id: ticketIds[0] }, { $set: { status: 'void', seatKey: null } });
      const res = await as(rafi.token).get(`/api/me/tickets/${ticketIds[0]}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ qrDataUrl: null, manualCode: null });
      expect(res.body.ticket.status).toBe('void');
    });
  });

  describe("someone else's booking or ticket → 404 (TR-05)", () => {
    const ROUTES = [
      { name: 'booking', url: (id: string) => `/api/me/bookings/${id}`, id: () => bookingId },
      { name: 'ticket', url: (id: string) => `/api/me/tickets/${id}`, id: () => ticketIds[0]! },
    ];

    for (const r of ROUTES) {
      it(`${r.name}: the same 404 as an id that doesn't exist (NFR-SEC-02)`, async () => {
        const foreign = await as(mina.token).get(r.url(r.id()));
        const random = await as(mina.token).get(r.url(new Types.ObjectId().toHexString()));
        expect(foreign.status).toBe(404);
        expect({ ...foreign.body.error, requestId: 0 }).toEqual({
          ...random.body.error,
          requestId: 0,
        });
      });

      it(`${r.name}: admins get no bypass`, async () => {
        const admin = await makeAdmin();
        expect((await as(admin.token).get(r.url(r.id()))).status).toBe(404);
      });

      it(`${r.name}: guests get 401`, async () => {
        expect((await request(app).get(r.url(r.id()))).status).toBe(401);
      });
    }
  });
});
