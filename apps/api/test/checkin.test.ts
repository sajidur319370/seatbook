import express from 'express';
import type { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Event, Scan, Ticket } from '../src/db/models';
import { formatManualCode, manualCode, qrCode } from '../src/lib/ticketCodes';
import { createCheckinLimiter } from '../src/middleware/rateLimits';
import { errorHandler } from '../src/middleware/errorHandler';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeOrganizer } from './helpers/roles';
import { makePublishedEvent } from './factories/events';

/** Starts in 1 h, so we're inside the check-in window (6 h before start → 2 h after end). */
const soon = () => {
  const startsAt = new Date(Date.now() + 3_600_000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3 * 3_600_000).toISOString(),
  };
};

describe('check-in', () => {
  let org: Awaited<ReturnType<typeof makeOrganizer>>;
  let eventId: string;
  let ticket: { _id: Types.ObjectId; eventId: Types.ObjectId };
  const url = (id = eventId) => `/api/organizer/events/${id}/check-in`;
  const scan = (body: object, id = eventId) => as(org.token).post(url(id)).send(body);

  beforeEach(async () => {
    org = await makeOrganizer();
    const made = await makePublishedEvent(org.token, soon());
    eventId = made.eventId;
    const [rafi] = await makeBuyers(1);
    await holdSeats(rafi!.token, eventId, [made.seats[0]!.id, made.seats[1]!.id]);
    expect((await pay(rafi!.token, eventId)).status).toBe(201);
    ticket = (await Ticket.findOne({ eventId }).sort({ seatLabel: 1 }).lean())!;
  });
  afterEach(() => vi.restoreAllMocks());

  it('valid QR → ok; same QR again → already used, with when, by whom and where', async () => {
    const code = qrCode(ticket._id, ticket.eventId);
    const first = await scan({ code, method: 'qr', gate: 'Gate 1' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      result: 'ok',
      ticket: { seatLabel: expect.any(String), holderName: 'Buyer 0' },
      counts: { checkedIn: 1, sold: 2 },
    });

    const second = await scan({ code, method: 'qr', gate: 'Gate 2' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      result: 'already_checked_in',
      ticket: {
        checkedInAt: first.body.ticket.checkedInAt,
        checkedInByName: org.user.name,
        checkedInGate: 'Gate 1',
      },
      counts: { checkedIn: 1, sold: 2 },
    });
  });

  it('bumps the display counter once per entry (FR-CHK-07)', async () => {
    const code = qrCode(ticket._id, ticket.eventId);
    await scan({ code, method: 'qr' });
    await scan({ code, method: 'qr' });
    expect((await Event.findById(eventId).lean())!.counters.ticketsCheckedIn).toBe(1);
  });

  it('two gates at the same moment → one ok, one already used (AC-CHK-01)', async () => {
    const code = qrCode(ticket._id, ticket.eventId);
    const [a, b] = await Promise.all([
      scan({ code, method: 'qr', gate: 'A' }),
      scan({ code, method: 'qr', gate: 'B' }),
    ]);
    expect([a.body.result, b.body.result].sort()).toEqual(['already_checked_in', 'ok']);
    expect(await Scan.countDocuments({ eventId })).toBe(2);
  });

  it('a QR from another event → wrong_event, ticket untouched (AC-CHK-02)', async () => {
    const other = await makePublishedEvent(org.token, soon());
    const res = await scan(
      { code: qrCode(ticket._id, ticket.eventId), method: 'qr' },
      other.eventId,
    );
    expect(res.body.result).toBe('wrong_event');
    expect((await Ticket.findById(ticket._id).lean())!.status).toBe('issued');
  });

  it('a forged code for a real ticket id is invalid, not wrong_event (no oracle)', async () => {
    const real = qrCode(ticket._id, ticket.eventId);
    const forged = real.slice(0, -4) + (real.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const other = await makePublishedEvent(org.token, soon());
    expect((await scan({ code: forged, method: 'qr' }, other.eventId)).body.result).toBe('invalid');
  });

  it('void ticket → void (AC-CHK-03)', async () => {
    await Ticket.updateOne(
      { _id: ticket._id },
      { $set: { status: 'void', seatKey: null, voidedAt: new Date() } },
    );
    const res = await scan({ code: qrCode(ticket._id, ticket.eventId), method: 'qr' });
    expect(res.body.result).toBe('void');
  });

  it("another organizer can't check in here (AC-CHK-04)", async () => {
    const other = await makeOrganizer('Other');
    const res = await as(other.token)
      .post(url())
      .send({ code: qrCode(ticket._id, ticket.eventId), method: 'qr' });
    expect(res.status).toBe(404);
    expect((await Ticket.findById(ticket._id).lean())!.status).toBe('issued');
    expect(await Scan.countDocuments({ eventId })).toBe(0);
  });

  it('tampered signature → invalid; malformed → no ticket query (AC-TKT-02)', async () => {
    const code = qrCode(ticket._id, ticket.eventId);
    const tampered = code.slice(0, -1) + (code.at(-1) === 'A' ? 'B' : 'A');
    expect((await scan({ code: tampered, method: 'qr' })).body.result).toBe('invalid');
    expect((await Ticket.findById(ticket._id).lean())!.status).toBe('issued');

    const spyOne = vi.spyOn(Ticket, 'findOne');
    const spyUpd = vi.spyOn(Ticket, 'findOneAndUpdate');
    for (const junk of ['not-a-ticket', 'SB2.' + 'a'.repeat(16) + '.' + 'b'.repeat(16), '§§§']) {
      expect((await scan({ code: junk, method: 'qr' })).body.result).toBe('invalid');
    }
    expect((await scan({ code: 'way too long to be a code', method: 'manual' })).body.result).toBe(
      'invalid',
    );
    expect(spyOne).not.toHaveBeenCalled();
    expect(spyUpd).not.toHaveBeenCalled();
  });

  it('manual code works, typed sloppily (FR-CHK-03)', async () => {
    const typed = formatManualCode(manualCode(ticket._id)).toLowerCase().replace('-', ' ');
    const res = await scan({ code: typed, method: 'manual' });
    expect(res.body.result).toBe('ok');
  });

  it("a well-formed manual code that isn't a ticket here → not_found", async () => {
    const res = await scan({ code: '0000-0000-00', method: 'manual' });
    expect(res.body).toMatchObject({ result: 'not_found', ticket: null });
  });

  it('a pasted QR string in the manual box works too', async () => {
    const res = await scan({ code: qrCode(ticket._id, ticket.eventId), method: 'manual' });
    expect(res.body.result).toBe('ok');
  });

  it('outside the window → outside_window, ticket untouched (FR-CHK-08)', async () => {
    const later = await makePublishedEvent(org.token); // starts in 20 days
    const [mina] = await makeBuyers(1);
    await holdSeats(mina!.token, later.eventId, [later.seats[0]!.id]);
    await pay(mina!.token, later.eventId);
    const t = (await Ticket.findOne({ eventId: later.eventId }).lean())!;
    const res = await scan({ code: qrCode(t._id, t.eventId), method: 'qr' }, later.eventId);
    expect(res.body.result).toBe('outside_window');
    expect((await Ticket.findById(t._id).lean())!.status).toBe('issued');
  });

  it('every attempt is logged, codes are not (FR-CHK-06)', async () => {
    const code = qrCode(ticket._id, ticket.eventId);
    await scan({ code: 'garbage', method: 'qr', gate: 'North' });
    await scan({ code, method: 'qr' });
    const scans = await Scan.find({ eventId }).sort({ createdAt: 1 }).lean();
    expect(scans.map((s) => s.result)).toEqual(['invalid', 'ok']);
    expect(scans[0]).toMatchObject({ ticketId: null, gate: 'North', method: 'qr' });
    expect(String(scans[1]!.ticketId)).toBe(String(ticket._id));
    const json = JSON.stringify(scans);
    expect(json).not.toContain('garbage');
    expect(json).not.toContain(code);
  });

  it('validation errors are the only 4xx', async () => {
    expect((await scan({ code: '', method: 'qr' })).status).toBe(400);
    expect((await scan({ code: 'x', method: 'nfc' })).status).toBe(400);
  });

  describe('scan log (GET /scans)', () => {
    it('newest first, with seat labels, filterable by result', async () => {
      const code = qrCode(ticket._id, ticket.eventId);
      await scan({ code: 'garbage', method: 'qr' });
      await scan({ code, method: 'qr', gate: 'East' });
      await scan({ code, method: 'qr' });

      const all = await as(org.token).get(`/api/organizer/events/${eventId}/scans`);
      expect(all.status).toBe(200);
      expect(all.body.items.map((s: { result: string }) => s.result)).toEqual([
        'already_checked_in',
        'ok',
        'invalid',
      ]);
      expect(all.body.items[1]).toMatchObject({
        gate: 'East',
        seatLabel: expect.any(String),
        holderName: 'Buyer 0',
      });
      expect(all.body.items[2]).toMatchObject({ seatLabel: null, holderName: null });
      expect(all.body.nextCursor).toBeNull();

      const okOnly = await as(org.token).get(`/api/organizer/events/${eventId}/scans?result=ok`);
      expect(okOnly.body.items).toHaveLength(1);
    });

    it("another organizer can't read it", async () => {
      const other = await makeOrganizer('Other');
      const res = await as(other.token).get(`/api/organizer/events/${eventId}/scans`);
      expect(res.status).toBe(404);
    });
  });
});

describe('check-in rate limit (FR-CHK-10)', () => {
  /** The real limiter on a tiny app: 4 hits a minute, and a route that charges again on demand. */
  function tinyApp() {
    const limiter = createCheckinLimiter({ limit: 4, skip: () => false });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { userId: String(req.headers['x-user']) } as never;
      next();
    });
    app.post('/scan', limiter.middleware, async (req, res) => {
      if (req.body.notFound) await limiter.chargeAgain(req);
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it('allows the limit, then answers 429', async () => {
    const app = tinyApp();
    const hit = () => request(app).post('/scan').set('x-user', 'nadia').send({});
    for (let i = 0; i < 4; i++) expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });

  it('a manual not_found counts double', async () => {
    const app = tinyApp();
    const hit = (notFound: boolean) =>
      request(app).post('/scan').set('x-user', 'nadia').send({ notFound });
    expect((await hit(true)).status).toBe(200); // 2
    expect((await hit(true)).status).toBe(200); // 4
    expect((await hit(false)).status).toBe(429);
  });

  it('is per organizer', async () => {
    const app = tinyApp();
    for (let i = 0; i < 4; i++) await request(app).post('/scan').set('x-user', 'a').send({});
    expect((await request(app).post('/scan').set('x-user', 'b').send({})).status).toBe(200);
  });
});
