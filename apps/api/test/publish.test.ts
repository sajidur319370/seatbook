import { gzipSync } from 'node:zlib';
import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { concertHall, generateSeats, newId } from '@seatbook/shared';
import { app } from './setup/app';
import { Event, Hold, Seat } from '../src/db/models';
import { addDays } from '../src/lib/dates';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import { eventInput, makeDraft, makePublishedEvent, smallLayout } from './factories/events';

const seatMapUrl = (id: string) => `/api/organizer/events/${id}/seat-map`;
const publishUrl = (id: string) => `/api/organizer/events/${id}/publish`;
const unpublishUrl = (id: string) => `/api/organizer/events/${id}/unpublish`;

async function saveLayout(token: string, layout: object, over: Record<string, unknown> = {}) {
  const draft = await makeDraft(token, over);
  const saved = await as(token)
    .put(seatMapUrl(draft.id))
    .send({ ...layout, expectedRevision: draft.revision });
  return { draft, saved };
}

/** A realistic 5,000-seat venue: 20 sections × 25 rows × 10 seats. */
function fiveThousandSeats() {
  const tier = { _id: newId(), name: 'Standard', price: 4000, color: 'teal' as const };
  return {
    stageLabel: 'STAGE',
    tiers: [tier],
    sections: Array.from({ length: 20 }, (_, i) => ({
      _id: newId(),
      name: `Section ${i}`,
      code: `S${i}`,
      x: i * 11,
      y: 0,
      numbering: 'ltr' as const,
      rows: Array.from({ length: 25 }, (_, r) => ({
        label: String.fromCharCode(65 + r),
        seats: 10,
        offset: 0,
        tierId: tier._id,
        gapsAfter: [],
        blocked: [],
      })),
    })),
  };
}

describe('save the seat map', () => {
  it('stores the layout, bumps the revision, and round-trips string ids', async () => {
    const org = await makeOrganizer();
    const layout = smallLayout();
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(200);
    expect(saved.body.event.revision).toBe(2);
    expect(saved.body.event.seatMap.sections[0]._id).toBe(layout.sections[0]!._id);
    expect(saved.body.event.seatMap.sections[0].rows[0].tierId).toBe(layout.tiers[0]!._id);
    expect(saved.body.event.seatMap.tiers[0]._id).toBe(layout.tiers[0]!._id);
    expect(saved.body.event.lowestPrice).toBe(4000);
  });

  it('an old revision → 409 STALE_DRAFT', async () => {
    const org = await makeOrganizer();
    const { draft } = await saveLayout(org.token, smallLayout());
    const res = await as(org.token)
      .put(seatMapUrl(draft.id))
      .send({ ...smallLayout(), expectedRevision: draft.revision });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_DRAFT');
  });

  it('layout errors come back as SEAT_MAP_INVALID with paths', async () => {
    const org = await makeOrganizer();
    const layout = smallLayout();
    layout.sections[0]!.rows[1]!.tierId = newId();
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe('SEAT_MAP_INVALID');
    expect(saved.body.error.details[0]).toMatchObject({
      path: ['sections', 0, 'rows', 1, 'tierId'],
      issue: 'UNKNOWN_TIER',
    });
  });

  it('an overlap names both seats (AC-MAP-01)', async () => {
    const org = await makeOrganizer();
    const layout = smallLayout();
    layout.sections[1]!.x = 4; // R's first column lands on L's last
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe('SEAT_MAP_INVALID');
    expect(saved.body.error.details[0]).toMatchObject({
      issue: 'OVERLAP',
      seats: ['L-A5', 'R-A1'],
      path: ['sections', 1, 'rows', 0],
    });
  });

  it('more than 5,000 seats → TOO_MANY_SEATS (AC-MAP-03)', async () => {
    const org = await makeOrganizer();
    const layout = fiveThousandSeats();
    layout.sections[0]!.rows[0]!.seats = 11; // 5,001
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.details[0]).toMatchObject({ issue: 'TOO_MANY_SEATS', count: 5001 });
  });

  it('a stacked layout gets a short answer, not thousands of errors', async () => {
    const org = await makeOrganizer();
    const tier = { _id: newId(), name: 'Standard', price: 4000, color: 'teal' as const };
    const row = { label: 'A', seats: 100, offset: 0, tierId: tier._id, gapsAfter: [], blocked: [] };
    const layout = {
      stageLabel: 'STAGE',
      tiers: [tier],
      sections: Array.from({ length: 20 }, (_, i) => ({
        _id: newId(),
        name: `S${i}`,
        code: `S${i}`,
        x: 0,
        y: 0,
        rows: [row],
      })),
    };
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.details).toHaveLength(20); // 1,900 overlaps exist
  });

  it('repeated section ids are refused instead of crashing publish later', async () => {
    const org = await makeOrganizer();
    const layout = smallLayout();
    layout.sections[1]!._id = layout.sections[0]!._id;
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.details[0]).toMatchObject({ issue: 'DUPLICATE_ID' });
  });

  it('a huge seat count → a fast 400, not a crashed server', async () => {
    const org = await makeOrganizer();
    const layout = smallLayout();
    layout.sections[0]!.rows[0]!.seats = 1_000_000_000;
    const start = Date.now();
    const { saved } = await saveLayout(org.token, layout);
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe('SEAT_MAP_INVALID');
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it.each([
    ['sections is not a list', { sections: 'nope', tiers: [] }],
    ['the body is empty', {}],
    ['rows are not objects', { tiers: [], sections: [{ rows: [1, 2] }] }],
  ])('a malformed body is a 400 when %s', async (_name, body) => {
    const org = await makeOrganizer();
    const { saved } = await saveLayout(org.token, body);
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe('SEAT_MAP_INVALID');
  });
});

describe('publish', () => {
  it('creates one seat per generated seat, blocked ones as blocked (AC-EVT-01)', async () => {
    const org = await makeOrganizer();
    const layout = concertHall();
    const { eventId } = await makePublishedEvent(org.token, {}, layout);
    const expected = generateSeats(layout);
    expect(await Seat.countDocuments({ eventId })).toBe(expected.length);
    expect(await Seat.countDocuments({ eventId, status: 'blocked' })).toBe(4);
    const ev = await Event.findOne({ _id: eventId }).lean();
    expect(ev!.counters).toMatchObject({
      seatsTotal: expected.length,
      seatsSellable: expected.length - 4,
      seatsSold: 0,
    });
  });

  it('every seat gets its tier’s price, label and position', async () => {
    const org = await makeOrganizer();
    const layout = concertHall();
    const { eventId } = await makePublishedEvent(org.token, {}, layout);
    const prices = new Map(layout.tiers.map((t) => [t._id, t.price]));
    const stored = await Seat.find({ eventId }).lean();
    const byLabel = new Map(stored.map((s) => [s.label, s]));
    for (const g of generateSeats(layout)) {
      const seat = byLabel.get(g.label)!;
      expect(seat.price).toBe(prices.get(g.tierId));
      expect([seat.x, seat.y, String(seat.tierId)]).toEqual([g.x, g.y, g.tierId]);
    }
    expect(stored.every((s) => s.version === 1)).toBe(true);
  });

  it('fills the sales window and bumps the revision', async () => {
    const org = await makeOrganizer();
    const before = Date.now();
    const { event } = await makePublishedEvent(org.token);
    expect(event).toMatchObject({ status: 'published', phase: 'on_sale', revision: 3 });
    expect(new Date(event.salesStartAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(event.salesEndAt).toBe(event.startsAt);
  });

  it('two parallel publishes create the seats once (AC-EVT-02)', async () => {
    const org = await makeOrganizer();
    const { draft } = await saveLayout(org.token, concertHall());
    const url = publishUrl(draft.id);
    const [a, b] = await Promise.all([as(org.token).post(url), as(org.token).post(url)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await Seat.countDocuments({ eventId: draft.id })).toBe(552);
    expect(a.body.event.status).toBe('published');
    expect(b.body.event.status).toBe('published');
  });

  it('publishing again later is a no-op', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token);
    const again = await as(org.token).post(publishUrl(eventId));
    expect(again.status).toBe(200);
    expect(again.body.event.revision).toBe(3);
    expect(await Seat.countDocuments({ eventId })).toBe(30);
  });

  it('a 5,000-seat event publishes in one go, and its seat map stays small', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token, {}, fiveThousandSeats());
    expect(await Seat.countDocuments({ eventId })).toBe(5000);

    const res = await request(app).get(`/api/events/${eventId}/seats`);
    expect(res.body.seats).toHaveLength(5000);
    expect(gzipSync(res.text).length).toBeLessThan(100 * 1024); // FR-VIEW-11
  });

  it('the seat map is frozen after publish (AC-EVT-03)', async () => {
    const org = await makeOrganizer();
    const { eventId, event } = await makePublishedEvent(org.token);
    const res = await as(org.token)
      .put(seatMapUrl(eventId))
      .send({ ...concertHall(), expectedRevision: event.revision });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_DRAFT');
  });

  it('refuses an event that starts in the past', async () => {
    const org = await makeOrganizer();
    const start = addDays(new Date(), -2);
    const { draft } = await saveLayout(org.token, smallLayout(), {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    const res = await as(org.token).post(publishUrl(draft.id));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_PUBLISHABLE');
    expect(res.body.error.details.map((d: { path: string[] }) => d.path[0])).toContain('startsAt');
    expect(await Seat.countDocuments({ eventId: draft.id })).toBe(0);
  });

  it('refuses sales that have already closed', async () => {
    const org = await makeOrganizer();
    const { draft } = await saveLayout(org.token, smallLayout(), {
      salesEndAt: addDays(new Date(), -1).toISOString(),
    });
    const res = await as(org.token).post(publishUrl(draft.id));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string[] }) => d.path[0])).toContain(
      'salesEndAt',
    );
  });

  it('refuses an event with no layout, or with nothing for sale', async () => {
    const org = await makeOrganizer();
    const empty = await makeDraft(org.token);
    const noLayout = await as(org.token).post(publishUrl(empty.id));
    expect(noLayout.status).toBe(400);
    expect(noLayout.body.error.code).toBe('NOT_PUBLISHABLE');

    const layout = smallLayout();
    layout.sections = layout.sections.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({ ...r, blocked: [1, 2, 3, 4, 5] as never[] })),
    }));
    const { draft } = await saveLayout(org.token, layout);
    const allBlocked = await as(org.token).post(publishUrl(draft.id));
    expect(allBlocked.status).toBe(400);
    expect(allBlocked.body.error.code).toBe('NOT_PUBLISHABLE');
  });

  it('a cancelled event cannot be published', async () => {
    const org = await makeOrganizer();
    const { draft } = await saveLayout(org.token, smallLayout());
    await Event.updateOne({ _id: draft.id }, { $set: { status: 'cancelled' } });
    const res = await as(org.token).post(publishUrl(draft.id));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_DRAFT');
  });
});

describe('unpublish', () => {
  it('deletes the seats, resets counters, and returns to draft', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token);
    const res = await as(org.token).post(unpublishUrl(eventId));
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ status: 'draft', phase: 'draft' });
    expect(res.body.event.counters.seatsTotal).toBe(0);
    expect(await Seat.countDocuments({ eventId })).toBe(0);
  });

  it('releases active holds', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token);
    const hold = await Hold.create({
      eventId,
      userId: new Types.ObjectId(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await as(org.token).post(unpublishUrl(eventId));
    expect((await Hold.findOne({ _id: hold._id }).lean())?.status).toBe('released');
  });

  it('is refused once there is a booking (AC-EVT-04)', async () => {
    const org = await makeOrganizer();
    const { eventId, seats } = await makePublishedEvent(org.token);
    const [buyer] = await makeBuyers(1);
    await holdSeats(buyer!.token, eventId, [seats[0]!.id]);
    expect((await pay(buyer!.token, eventId)).status).toBe(201); // a real booking (Day 16)
    const res = await as(org.token).post(unpublishUrl(eventId));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_HAS_BOOKINGS');
    expect(await Seat.countDocuments({ eventId })).toBe(30);
  });

  it('a draft cannot be unpublished', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    const res = await as(org.token).post(unpublishUrl(draft.id));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_PUBLISHED');
  });

  it('clears the sales dates publish filled in, and keeps ones the organizer chose', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token);
    const res = await as(org.token).post(unpublishUrl(eventId));
    expect(res.body.event.salesStartAt).toBeNull();
    expect(res.body.event.salesEndAt).toBeNull();

    const salesStartAt = addDays(new Date(), 1).toISOString();
    const salesEndAt = addDays(new Date(), 2).toISOString();
    const chosen = await makePublishedEvent(org.token, { salesStartAt, salesEndAt });
    const kept = await as(org.token).post(unpublishUrl(chosen.eventId));
    expect(kept.body.event.salesStartAt).toBe(salesStartAt);
    expect(kept.body.event.salesEndAt).toBe(salesEndAt);
  });

  it('can be published again, with a fresh set of seats', async () => {
    const org = await makeOrganizer();
    const { eventId } = await makePublishedEvent(org.token);
    await as(org.token).post(unpublishUrl(eventId));
    const again = await as(org.token).post(publishUrl(eventId));
    expect(again.status).toBe(200);
    expect(await Seat.countDocuments({ eventId })).toBe(30);
  });
});

describe('public seat map', () => {
  it('returns compact seats and treats expired holds as available', async () => {
    const org = await makeOrganizer();
    const { eventId, seats } = await makePublishedEvent(org.token);
    // Simulate a hold that expired a second ago (holds arrive on Day 11).
    await Seat.updateOne(
      { _id: seats[0]!.id },
      { $set: { status: 'held', holdExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await request(app)
      .get(`/api/events/${eventId}/seats`)
      .set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.seats).toHaveLength(30);
    const cell = res.body.seats.find((c: { id: string }) => c.id === seats[0]!.id);
    expect(cell.st).toBe('available'); // lazy expiry (FR-EXP-01)
    expect(cell).not.toHaveProperty('exp');
    expect(cell).not.toHaveProperty('heldBy');
  });

  it('a live hold shows as held, with its expiry but no identities', async () => {
    const org = await makeOrganizer();
    const { eventId, seats } = await makePublishedEvent(org.token);
    const holdExpiresAt = new Date(Date.now() + 60_000);
    await Seat.updateOne(
      { _id: seats[0]!.id },
      {
        $set: {
          status: 'held',
          holdExpiresAt,
          heldBy: new Types.ObjectId(),
          holdId: new Types.ObjectId(),
        },
      },
    );
    const res = await request(app).get(`/api/events/${eventId}/seats`);
    const cell = res.body.seats.find((c: { id: string }) => c.id === seats[0]!.id);
    expect(cell).toMatchObject({ st: 'held', exp: holdExpiresAt.toISOString() });
    expect(res.text).not.toMatch(/heldBy|holdId|organizerId/);
  });

  it('indexes point at the right section and tier', async () => {
    const org = await makeOrganizer();
    const layout = concertHall();
    const { eventId } = await makePublishedEvent(org.token, {}, layout);
    const res = await request(app).get(`/api/events/${eventId}/seats`);
    expect(res.body.serverTime).toEqual(expect.any(String));
    expect(res.body.event.id).toBe(eventId);
    expect(res.body.layout.stageLabel).toBe('STAGE');

    const generated = new Map(generateSeats(layout).map((g) => [g.label, g]));
    for (const c of res.body.seats) {
      const section = res.body.layout.sections[c.s];
      const g = generated.get(`${section.code}-${c.r}${c.n}`)!;
      expect(res.body.tiers[c.t]._id).toBe(g.tierId);
      expect([c.x, c.y]).toEqual([g.x, g.y]);
    }
  });

  it('a draft’s map is for its owner and admins only', async () => {
    const org = await makeOrganizer();
    const other = await makeOrganizer();
    const admin = await makeAdmin();
    const { draft } = await saveLayout(org.token, smallLayout());
    const url = `/api/events/${draft.id}/seats`;
    expect((await request(app).get(url)).status).toBe(404);
    expect((await as(other.token).get(url)).status).toBe(404);
    const owner = await as(org.token).get(url);
    expect(owner.status).toBe(200);
    expect(owner.body.seats).toEqual([]);
    expect(owner.body.layout.sections).toHaveLength(2);
    expect((await as(admin.token).get(url)).status).toBe(200);
  });

  it('a bad id → 400; an unknown one → 404', async () => {
    expect((await request(app).get('/api/events/not-an-id/seats')).status).toBe(400);
    const unknown = new Types.ObjectId().toHexString();
    expect((await request(app).get(`/api/events/${unknown}/seats`)).status).toBe(404);
  });
});

describe('event page', () => {
  it('shows remaining seats per tier, counting expired holds as free (FR-EVT-08)', async () => {
    const org = await makeOrganizer();
    const layout = concertHall();
    const { event, eventId } = await makePublishedEvent(org.token, {}, layout);
    const vip = layout.tiers[0]!;
    const vipSeats = await Seat.find({ eventId, tierId: vip._id }).limit(3).lean();
    await Seat.updateOne(
      { _id: vipSeats[0]!._id },
      { $set: { status: 'held', holdExpiresAt: new Date(Date.now() + 60_000) } },
    );
    await Seat.updateOne(
      { _id: vipSeats[1]!._id },
      { $set: { status: 'held', holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    await Seat.updateOne({ _id: vipSeats[2]!._id }, { $set: { status: 'booked' } });

    const res = await request(app).get(`/api/events/${event.slug}`);
    const tiers = res.body.event.tiers;
    const generated = generateSeats(layout);
    const count = (id: string) => generated.filter((g) => g.tierId === id && !g.blocked).length;
    expect(tiers[0]).toEqual({
      id: vip._id,
      name: 'VIP',
      price: 7500,
      color: 'purple',
      remaining: count(vip._id) - 2, // the live hold and the booking; the expired hold is free
    });
    expect(tiers[1].remaining).toBe(count(layout.tiers[1]!._id)); // blocked seats don't count
    expect(tiers[2].remaining).toBe(count(layout.tiers[2]!._id));
  });
});

describe('factories', () => {
  it('eventInput still builds a valid draft', async () => {
    const org = await makeOrganizer();
    const res = await as(org.token).post('/api/organizer/events').send(eventInput());
    expect(res.status).toBe(201);
  });
});
