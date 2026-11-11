import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { Booking, Ticket } from '../src/db/models';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeOrganizer } from './helpers/roles';
import { makePublishedEvent } from './factories/events';

type Buyer = Awaited<ReturnType<typeof makeBuyers>>[number];

describe('attendee list (FR-DASH-06)', () => {
  let org: Awaited<ReturnType<typeof makeOrganizer>>;
  let eventId: string;
  let seats: { id: string; label: string }[];
  let rafi: Buyer;
  let mina: Buyer;
  let refRafi: string;
  const list = (q = '') =>
    as(org.token).get(`/api/organizer/events/${eventId}/attendees${q ? `?${q}` : ''}`);

  beforeEach(async () => {
    org = await makeOrganizer();
    ({ eventId, seats } = await makePublishedEvent(org.token));
    [rafi, mina] = (await makeBuyers(2)) as [Buyer, Buyer]; // "Buyer 0", "Buyer 1"
    await holdSeats(rafi.token, eventId, [seats[0]!.id, seats[1]!.id]);
    refRafi = (await pay(rafi.token, eventId)).body.booking.reference;
    await holdSeats(mina.token, eventId, [seats[20]!.id]);
    await pay(mina.token, eventId);
  });

  it('lists every ticket with the email and reference from its booking', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      holderName: 'Buyer 0',
      email: rafi.email,
      reference: refRafi,
      status: 'issued',
      checkedInAt: null,
    });
    expect(res.body.nextCursor).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/manualCodeHash|chargeId|idempotencyKey/);
  });

  it.each([
    ['part of a name', 'q=uyer 1', 1],
    ['an email prefix', () => `q=${encodeURIComponent(rafi.email.slice(0, 8))}`, 2],
    ['the reference, typed in lower case', () => `q=${refRafi.toLowerCase()}`, 2],
    ['a seat label', () => `q=${encodeURIComponent(seats[20]!.label)}`, 1],
  ] as const)('searches by %s', async (_name, query, n) => {
    const res = await list(typeof query === 'function' ? query() : query);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(n);
  });

  it('regex characters in a search are plain text', async () => {
    const res = await list(`q=${encodeURIComponent('.*')}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('leaves void tickets out', async () => {
    await Ticket.updateOne(
      { seatLabel: seats[20]!.label },
      { $set: { status: 'void', seatKey: null } },
    );
    expect((await list()).body.items).toHaveLength(2);
  });

  it('pages 50 at a time with a cursor', async () => {
    const t = (await Ticket.findOne({ eventId }).lean())!;
    const { _id, ...copy } = t;
    await Ticket.collection.insertMany(
      Array.from({ length: 52 }, (_, i) => ({
        ...copy,
        _id: new Types.ObjectId(),
        seatKey: null, // copies of one seat: keep them out of the one-live-ticket index
        manualCodeHash: `fake-${i}`,
      })),
    );
    expect(_id).toBeTruthy();
    const first = await list();
    expect(first.body.items).toHaveLength(50);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await list(`cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(5); // 55 in all
    const ids = [...first.body.items, ...second.body.items].map(
      (r: { ticketId: string }) => r.ticketId,
    );
    expect(new Set(ids).size).toBe(55);
  });

  it('rejects a cursor that is not an id', async () => {
    expect((await list('cursor=nope')).status).toBe(400);
  });

  it("another organizer gets 404, and can't search this event's buyers", async () => {
    const other = await makeOrganizer('Other');
    const res = await as(other.token).get(`/api/organizer/events/${eventId}/attendees`);
    expect(res.status).toBe(404);
    expect(await Booking.countDocuments({ eventId })).toBe(2);
  });
});
