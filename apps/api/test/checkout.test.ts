import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Booking, Event, Hold, Seat, Ticket } from '../src/db/models';
import { sweepOnce } from '../src/jobs/holdSweeper';
import { manualCode, qrCode } from '../src/lib/ticketCodes';
import { outbox } from '../src/mail/mailer';
import { payments } from '../src/payments/mockProvider';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeOrganizer } from './helpers/roles';
import { makePublishedEvent } from './factories/events';

describe('checkout', () => {
  let eventId: string;
  let seats: { id: string }[];
  let org: Awaited<ReturnType<typeof makeOrganizer>>;
  let rafi: Awaited<ReturnType<typeof makeBuyers>>[number] | undefined;
  const activeHold = () => Hold.findOne({ userId: rafi!.user.id, status: 'active' }).lean();

  beforeEach(async () => {
    org = await makeOrganizer();
    ({ eventId, seats } = await makePublishedEvent(org.token));
    [rafi] = await makeBuyers(1);
    await holdSeats(rafi!.token, eventId, [seats[0]!.id, seats[1]!.id]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('books the seats and issues one ticket per seat', async () => {
    const res = await pay(rafi!.token, eventId);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      reference: expect.stringMatching(/^SB-/),
      total: 8000,
      currency: 'BDT',
      status: 'confirmed',
      payment: { brand: 'visa', last4: '4242' },
    });
    expect(res.body.booking.tickets).toHaveLength(2);
    expect(await Seat.countDocuments({ eventId, status: 'booked' })).toBe(2);
    expect((await Hold.findOne({ userId: rafi!.user.id }).lean())!.status).toBe('converted');
  });

  it('the booked seats carry the booking and no hold any more (I16)', async () => {
    const res = await pay(rafi!.token, eventId);
    const seat = (await Seat.findById(seats[0]!.id).lean())!;
    expect(String(seat.bookingId)).toBe(res.body.booking.id);
    expect(seat).toMatchObject({ holdId: null, heldBy: null, holdExpiresAt: null });
  });

  it('bumps the display counters after commit and mails a link, never a code', async () => {
    const res = await pay(rafi!.token, eventId);
    const ev = (await Event.findById(eventId).lean())!;
    expect(ev.counters).toMatchObject({ seatsSold: 2, revenue: 8000 });

    const mail = outbox.at(-1)!;
    expect(mail.to).toBe(rafi!.email);
    expect(mail.subject).toContain(res.body.booking.reference);
    expect(mail.text).toContain(`/bookings/${res.body.booking.id}`);
    for (const t of await Ticket.find({ eventId }).lean()) {
      expect(mail.text).not.toContain(manualCode(t._id));
      expect(mail.text).not.toContain(qrCode(t._id, t.eventId));
    }
  });

  it('20 parallel checkouts of one hold → 1 booking, 1 charge (AC-PAY-01)', async () => {
    const charge = vi.spyOn(payments, 'charge');
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(rafi!.token, eventId)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [201, 404, 409].includes(r.status))).toBe(true);
    expect(await Booking.countDocuments({ eventId })).toBe(1);
    expect(await Ticket.countDocuments({ eventId })).toBe(2);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('same Idempotency-Key twice → same booking, one charge (AC-PAY-02)', async () => {
    const charge = vi.spyOn(payments, 'charge');
    const key = randomUUID();
    const a = await pay(rafi!.token, eventId, 'tok_visa', key);
    const b = await pay(rafi!.token, eventId, 'tok_visa', key);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.booking.id).toBe(a.body.booking.id);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('the same key in parallel (a double click) → one booking, never two charges', async () => {
    const charge = vi.spyOn(payments, 'charge');
    const key = randomUUID();
    const [a, b] = await Promise.all([
      pay(rafi!.token, eventId, 'tok_visa', key),
      pay(rafi!.token, eventId, 'tok_visa', key),
    ]);
    const loser = a.status === 201 ? b : a;
    expect([a.status, b.status]).toContain(201);
    expect([200, 409]).toContain(loser.status); // a replay, or CHECKOUT_IN_PROGRESS: never a 2nd booking
    expect(charge).toHaveBeenCalledTimes(1);
    // …and its retry, once the winner is done, is a replay.
    const retry = await pay(rafi!.token, eventId, 'tok_visa', key);
    expect(retry.status).toBe(200);
  });

  it('declined card keeps the hold; a good card then works (AC-PAY-03)', async () => {
    const declined = await pay(rafi!.token, eventId, 'tok_chargeDeclined');
    expect(declined.status).toBe(402);
    expect(declined.body.error.code).toBe('PAYMENT_DECLINED');
    expect((await activeHold())!.checkoutStartedAt).toBeNull();
    expect(await Seat.countDocuments({ eventId, status: 'held' })).toBe(2);
    expect((await pay(rafi!.token, eventId, 'tok_visa')).status).toBe(201);
  });

  it('a provider outage → 502, not charged, the hold is kept', async () => {
    const res = await pay(rafi!.token, eventId, 'tok_providerError');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect((await activeHold())!.checkoutStartedAt).toBeNull();
    expect(await Booking.countDocuments({ eventId })).toBe(0);
  });

  it('three declines → TOO_MANY_ATTEMPTS (E12)', async () => {
    for (let i = 0; i < 3; i++)
      expect((await pay(rafi!.token, eventId, 'tok_chargeDeclined')).status).toBe(402);
    const res = await pay(rafi!.token, eventId, 'tok_visa');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('a seat lost between charge and commit → refund, no booking (AC-PAY-04)', async () => {
    const refund = vi.spyOn(payments, 'refund');
    const realCharge = payments.charge.bind(payments);
    vi.spyOn(payments, 'charge').mockImplementationOnce(async (p) => {
      const result = await realCharge(p);
      // Fault injection: something releases one of the held seats right after the charge.
      await Seat.updateOne(
        { _id: seats[1]!.id },
        {
          $set: { status: 'available', holdId: null, heldBy: null, holdExpiresAt: null },
          $inc: { version: 1 },
        },
      );
      return result;
    });

    const res = await pay(rafi!.token, eventId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_LOST');
    expect(refund).toHaveBeenCalledTimes(1);
    expect(await Booking.countDocuments({ eventId })).toBe(0);
    expect(await Ticket.countDocuments({ eventId })).toBe(0);
    expect((await Seat.findById(seats[0]!.id).lean())!.status).toBe('held'); // rolled back
    expect((await activeHold())!.checkoutStartedAt).toBeNull(); // unlocked
  });

  it('a slow card survives the sweeper thanks to the payment window (AC-PAY-05)', async () => {
    // Only 5 s left on the hold.
    const soon = new Date(Date.now() + 5_000);
    await Hold.updateOne(
      { userId: rafi!.user.id, status: 'active' },
      { $set: { expiresAt: soon } },
    );
    await Seat.updateMany({ eventId, status: 'held' }, { $set: { holdExpiresAt: soon } });

    // .then() sends it NOW: a supertest request only starts when something awaits it.
    const paying = pay(rafi!.token, eventId, 'tok_slow').then((r) => r); // 1.5 s in tests
    await new Promise((r) => setTimeout(r, 300));
    await sweepOnce(new Date(Date.now() + 10_000), 'test'); // "10 s later": expired without the window
    const res = await paying;
    expect(res.status).toBe(201);
  }, 15_000);

  it('a hold that expired before Pay → 410 HOLD_EXPIRED (E6)', async () => {
    const past = new Date(Date.now() - 1_000);
    await Hold.updateOne(
      { userId: rafi!.user.id, status: 'active' },
      { $set: { expiresAt: past } },
    );
    await Seat.updateMany({ eventId, status: 'held' }, { $set: { holdExpiresAt: past } });
    const res = await pay(rafi!.token, eventId);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('a hold whose seats are all gone → 409 HOLD_EMPTY, and no charge', async () => {
    const charge = vi.spyOn(payments, 'charge');
    await Seat.updateMany(
      { eventId, status: 'held' },
      { $set: { status: 'available', holdId: null, heldBy: null, holdExpiresAt: null } },
    );
    const res = await pay(rafi!.token, eventId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_EMPTY');
    expect(charge).not.toHaveBeenCalled();
    expect((await activeHold())!.checkoutStartedAt).toBeNull();
  });

  it('nobody can pay for my hold: they have none (404)', async () => {
    const [eve] = await makeBuyers(1);
    const res = await pay(eve!.token, eventId);
    expect(res.status).toBe(404);
    expect(await Booking.countDocuments({ eventId })).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'abc'],
    ['a UUID that is not v4', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
  ])('Idempotency-Key %s → 400', async (_name, key) => {
    const req = as(rafi!.token).post(`/api/events/${eventId}/hold/checkout`);
    const res = await (key ? req.set('Idempotency-Key', key) : req).send({
      paymentToken: 'tok_visa',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('an unknown test card is a validation error', async () => {
    const res = await pay(rafi!.token, eventId, 'tok_free_money');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('the database stores no ticket code (AC-TKT-01)', async () => {
    const res = await pay(rafi!.token, eventId);
    const tickets = await Ticket.find({ eventId }).lean();
    const dump = JSON.stringify(tickets) + JSON.stringify(await Booking.find({ eventId }).lean());
    expect(res.body.booking.tickets).toHaveLength(2);
    for (const t of res.body.booking.tickets) {
      const tk = tickets.find((x) => String(x._id) === t.id)!;
      expect(dump).not.toContain(qrCode(tk._id, tk.eventId));
      expect(dump).not.toContain(manualCode(tk._id));
    }
    expect(JSON.stringify(res.body)).not.toContain('manualCodeHash');
  });

  it('a second live ticket for a seat is impossible (AC-TKT-03)', async () => {
    await pay(rafi!.token, eventId);
    const t = (await Ticket.findOne({ eventId }).lean())!;
    const { _id, ...copy } = t;
    await expect(Ticket.create({ ...copy, manualCodeHash: 'x'.repeat(64) })).rejects.toMatchObject({
      code: 11000,
    });
    // A void ticket (seatKey null) leaves the index, so the seat can be sold again later.
    await Ticket.updateOne({ _id }, { $set: { status: 'void', seatKey: null } });
    await expect(Ticket.create({ ...copy, manualCodeHash: 'y'.repeat(64) })).resolves.toBeTruthy();
  });

  it('the constraint indexes exist after syncAllIndexes() (schema.md §14)', async () => {
    const names = async (m: typeof Booking | typeof Ticket) =>
      (await m.listIndexes()).map((i) => i.name);
    expect(await names(Ticket)).toEqual(
      expect.arrayContaining(['one_live_ticket_per_seat', 'uniq_manual_code']),
    );
    expect(await names(Booking)).toEqual(
      expect.arrayContaining(['uniq_booking_hold', 'uniq_idempotency', 'uniq_booking_reference']),
    );
  });

  it('unpublish is refused once a booking exists (AC-EVT-04)', async () => {
    expect((await pay(rafi!.token, eventId)).status).toBe(201);
    const res = await as(org.token).post(`/api/organizer/events/${eventId}/unpublish`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_HAS_BOOKINGS');
    expect((await Event.findById(eventId).lean())!.status).toBe('published');
  });
});
