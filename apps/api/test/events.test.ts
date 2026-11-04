import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { as } from './helpers/auth';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import { eventInput, makeDraft, makePublished } from './factories/events';
import { env } from '../src/config/env';
import { Event } from '../src/db/models';
import { addDays } from '../src/lib/dates';
import { slugify, slugWithSuffix } from '../src/lib/slug';

const eventUrl = (id: string) => `/api/organizer/events/${id}`;
const hours = (d: Date, n: number) => new Date(d.getTime() + n * 3_600_000).toISOString();
const inDays = (n: number) => addDays(new Date(), n);

describe('slugs', () => {
  it.each([
    ['Hamlet — Evening Show', 'hamlet-evening-show'],
    ['Café Crème!!', 'cafe-creme'],
    ['  --Trim me--  ', 'trim-me'],
    ['হ্যামলেট', 'event'], // no Latin letters
    [`${'a'.repeat(59)} b`, 'a'.repeat(59)], // the cut must not leave a trailing dash
  ])('%s → %s', (title, slug) => expect(slugify(title)).toBe(slug));

  it('adds a 4-character suffix', () => {
    expect(slugWithSuffix('Hamlet')).toMatch(/^hamlet-[0-9a-z]{4}$/);
  });
});

describe('create', () => {
  it('makes a draft owned by the caller, with the defaults', async () => {
    const org = await makeOrganizer();
    const res = await as(org.token).post('/api/organizer/events').send(eventInput());
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      status: 'draft',
      phase: 'draft',
      revision: 1,
      summary: '',
      category: 'other',
      maxSeatsPerOrder: 8,
      coverColor: 'indigo',
      refundsAllowed: false,
      soldOut: false,
      lowestPrice: null,
      counters: { seatsSold: 0 },
    });
    expect(res.body.event.slug).toMatch(/^hamlet-evening-show-[0-9a-z]{4}$/);
    const stored = await Event.findOne({ _id: res.body.event.id }).lean();
    expect(String(stored?.organizerId)).toBe(org.user.id);
  });

  it('ignores fields a client may never set (NFR-SEC-14)', async () => {
    const org = await makeOrganizer();
    const other = new Types.ObjectId().toHexString();
    const res = await as(org.token)
      .post('/api/organizer/events')
      .send(
        eventInput({
          organizerId: other,
          status: 'published',
          slug: 'my-own-slug',
          revision: 99,
          counters: { seatsSold: 500 },
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ status: 'draft', revision: 1 });
    expect(res.body.event.counters.seatsSold).toBe(0);
    expect(res.body.event.slug).not.toBe('my-own-slug');
    const stored = await Event.findOne({ _id: res.body.event.id }).lean();
    expect(String(stored?.organizerId)).toBe(org.user.id);
  });

  it.each([
    [
      'ends before it starts',
      (s: Date) => ({ startsAt: hours(s, 0), endsAt: hours(s, -1) }),
      'endsAt',
    ],
    ['lasts 25 hours', (s: Date) => ({ startsAt: hours(s, 0), endsAt: hours(s, 25) }), 'endsAt'],
    [
      'sales end after the event',
      (s: Date) => ({ startsAt: hours(s, 0), endsAt: hours(s, 3), salesEndAt: hours(s, 4) }),
      'salesEndAt',
    ],
    [
      'sales start after they end',
      (s: Date) => ({
        startsAt: hours(s, 0),
        endsAt: hours(s, 3),
        salesStartAt: hours(s, 2),
        salesEndAt: hours(s, 1),
      }),
      'salesStartAt',
    ],
  ])('rejects a schedule that %s', async (_name, schedule, field) => {
    const org = await makeOrganizer();
    const res = await as(org.token)
      .post('/api/organizer/events')
      .send(eventInput(schedule(inDays(20))));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe(field);
  });

  it.each([
    ['no offset', { startsAt: '2030-01-01T19:30:00' }, 'startsAt'],
    ['not a date', { endsAt: 'tomorrow' }, 'endsAt'],
    ['missing', { startsAt: undefined }, 'startsAt'],
    ['a bad sales date', { salesEndAt: 'soon' }, 'salesEndAt'],
  ])('a date that is %s → 400 on that field, never a 500', async (_name, over, field) => {
    const org = await makeOrganizer();
    const res = await as(org.token).post('/api/organizer/events').send(eventInput(over));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects a date with no offset, and an unknown zone', async () => {
    const org = await makeOrganizer();
    const noOffset = await as(org.token)
      .post('/api/organizer/events')
      .send(eventInput({ startsAt: '2030-01-01T19:30:00' }));
    expect(noOffset.status).toBe(400);
    const badZone = await as(org.token)
      .post('/api/organizer/events')
      .send(eventInput({ timezone: 'Mars/Base' }));
    expect(badZone.status).toBe(400);
  });

  it('an organizer can have at most 200 events (FR-EVT-09)', async () => {
    const org = await makeOrganizer();
    const { startsAt, endsAt } = eventInput();
    await Event.insertMany(
      Array.from({ length: 200 }, (_, i) => ({
        organizerId: org.user.id,
        title: `Event ${i}`,
        slug: `event-${i}`,
        venue: { name: 'Hall', city: 'Dhaka' },
        timezone: 'UTC',
        startsAt,
        endsAt,
      })),
    );
    const res = await as(org.token).post('/api/organizer/events').send(eventInput());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'EVENT_LIMIT',
      message: 'You can have at most 200 events.',
    });
  });
});

describe('update', () => {
  it('changes only what was sent, and bumps the revision', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token, {
      summary: 'A summary worth keeping',
      description: 'A long description',
      category: 'theatre',
      coverColor: 'teal',
      maxSeatsPerOrder: 4,
      refundsAllowed: true,
    });
    const res = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({ title: 'Hamlet — Matinee', expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      title: 'Hamlet — Matinee',
      revision: 2,
      slug: draft.slug, // the slug doesn't follow the title
      summary: 'A summary worth keeping',
      description: 'A long description',
      category: 'theatre',
      coverColor: 'teal',
      currency: 'BDT',
      maxSeatsPerOrder: 4,
      refundsAllowed: true,
    });
  });

  it('an old revision → 409 STALE_DRAFT with the current revision', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    await as(org.token).patch(eventUrl(draft.id)).send({ title: 'First', expectedRevision: 1 });
    const stale = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({ title: 'Second', expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_DRAFT');
    expect(stale.body.error.details).toEqual({ revision: 2 });
    expect((await Event.findOne({ _id: draft.id }).lean())?.title).toBe('First');
  });

  it('two parallel edits of one revision: exactly one wins', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    const edit = (title: string) =>
      as(org.token).patch(eventUrl(draft.id)).send({ title, expectedRevision: 1 });
    const results = await Promise.all([edit('Tab A'), edit('Tab B'), edit('Tab C')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await Event.findOne({ _id: draft.id }).lean())?.revision).toBe(2);
  });

  it('needs expectedRevision', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    const res = await as(org.token).patch(eventUrl(draft.id)).send({ title: 'No revision' });
    expect(res.status).toBe(400);
  });

  it('checks the schedule against the stored dates', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    const res = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({ endsAt: inDays(1).toISOString(), expectedRevision: 1 }); // before the stored start
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCHEDULE');
    expect((await Event.findOne({ _id: draft.id }).lean())?.revision).toBe(1);
  });

  it('can clear the sales window', async () => {
    const org = await makeOrganizer();
    const salesStartAt = inDays(5).toISOString();
    const draft = await makeDraft(org.token, { salesStartAt });
    const res = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({ salesStartAt: null, expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect(res.body.event.salesStartAt).toBeNull();
  });

  it('ignores status, owner and counters in the body', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    const res = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({
        expectedRevision: 1,
        title: 'Still a draft',
        status: 'published',
        organizerId: new Types.ObjectId().toHexString(),
        counters: { revenue: 1 },
      });
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('draft');
    expect(res.body.event.counters.revenue).toBe(0);
    const stored = await Event.findOne({ _id: draft.id }).lean();
    expect(String(stored?.organizerId)).toBe(org.user.id);
  });

  it('after publishing: details can change, the locked fields cannot (FR-EVT-02)', async () => {
    const org = await makeOrganizer();
    const event = await makePublished(org.token, { summary: 'Keep me' });

    const title = await as(org.token)
      .patch(eventUrl(event.id))
      .send({ title: 'New title', expectedRevision: 1 });
    expect(title.status).toBe(200);
    expect(title.body.event).toMatchObject({ title: 'New title', summary: 'Keep me' });

    const locked = await as(org.token)
      .patch(eventUrl(event.id))
      .send({ startsAt: inDays(30).toISOString(), currency: 'USD', expectedRevision: 2 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('EVENT_NOT_DRAFT');
    expect(locked.body.error.details.fields.sort()).toEqual(['currency', 'startsAt']);
  });

  it('a cancelled event cannot be edited', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    await Event.updateOne({ _id: draft.id }, { $set: { status: 'cancelled' } });
    const res = await as(org.token)
      .patch(eventUrl(draft.id))
      .send({ title: 'Too late', expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'EVENT_CANCELLED',
      message: 'This event was cancelled.',
    });
  });
});

describe('delete', () => {
  it('removes a draft once; a second try → 404', async () => {
    const org = await makeOrganizer();
    const draft = await makeDraft(org.token);
    expect((await as(org.token).delete(eventUrl(draft.id))).status).toBe(204);
    expect((await as(org.token).delete(eventUrl(draft.id))).status).toBe(404);
  });

  it('a published event cannot be deleted', async () => {
    const org = await makeOrganizer();
    const event = await makePublished(org.token);
    const res = await as(org.token).delete(eventUrl(event.id));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_DRAFT');
  });
});

describe('my events', () => {
  it('lists mine, newest start first, filtered by status', async () => {
    const org = await makeOrganizer();
    const soon = inDays(5);
    const later = inDays(10);
    await makeDraft(org.token, {
      title: 'Soon',
      startsAt: hours(soon, 0),
      endsAt: hours(soon, 2),
    });
    await makePublished(org.token, {
      title: 'Later',
      startsAt: hours(later, 0),
      endsAt: hours(later, 2),
    });

    const all = await as(org.token).get('/api/organizer/events');
    expect(all.body.items.map((e: { title: string }) => e.title)).toEqual(['Later', 'Soon']);
    const drafts = await as(org.token).get('/api/organizer/events?status=draft');
    expect(drafts.body.items.map((e: { title: string }) => e.title)).toEqual(['Soon']);
    expect((await as(org.token).get('/api/organizer/events?status=nope')).status).toBe(400);
  });
});

describe('public listing', () => {
  const titles = (res: { body: { items: { title: string }[] } }) =>
    res.body.items.map((e) => e.title);

  it('shows only published, not-ended events, soonest first', async () => {
    const org = await makeOrganizer();
    const [d5, d9, past] = [inDays(5), inDays(9), inDays(-3)];
    await makePublished(org.token, {
      title: 'Later',
      startsAt: hours(d9, 0),
      endsAt: hours(d9, 2),
    });
    await makePublished(org.token, {
      title: 'Sooner',
      startsAt: hours(d5, 0),
      endsAt: hours(d5, 2),
    });
    await makePublished(org.token, {
      title: 'Ended',
      startsAt: hours(past, 0),
      endsAt: hours(past, 2),
    });
    await makeDraft(org.token, { title: 'Draft' });
    const cancelled = await makePublished(org.token, { title: 'Cancelled' });
    await Event.updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });

    const res = await request(app).get('/api/events'); // no login needed
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Sooner', 'Later']);
  });

  it('never exposes internal fields', async () => {
    const org = await makeOrganizer();
    await makePublished(org.token, { description: 'Long text' });
    const res = await request(app).get('/api/events');
    const card = res.body.items[0];
    for (const key of ['organizerId', 'counters', 'revision', 'status', 'seatMap', 'description']) {
      expect(card).not.toHaveProperty(key);
    }
    expect(card).toMatchObject({ phase: 'on_sale', soldOut: false });
  });

  it('pages through 30 events with no repeats, even with identical start times', async () => {
    const org = await makeOrganizer();
    const { startsAt, endsAt } = eventInput();
    await Event.insertMany(
      Array.from({ length: 30 }, (_, i) => ({
        organizerId: org.user.id,
        title: `Event ${i}`,
        slug: `event-${i}`,
        venue: { name: 'Hall', city: 'Dhaka' },
        timezone: 'UTC',
        startsAt,
        endsAt,
        status: 'published',
      })),
    );
    const first = await request(app).get('/api/events');
    expect(first.body.items).toHaveLength(24);
    const second = await request(app).get(`/api/events?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(6);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(30);
    expect((await request(app).get('/api/events?cursor=garbage')).status).toBe(400);
  });

  it('search covers title, venue and city, and also works with a cursor (FR-EVT-07)', async () => {
    const org = await makeOrganizer();
    const { startsAt, endsAt } = eventInput();
    const base = {
      organizerId: org.user.id,
      timezone: 'UTC',
      startsAt,
      endsAt,
      status: 'published',
    };
    await Event.insertMany([
      { ...base, title: 'Hamlet', slug: 'a', venue: { name: 'Main Hall', city: 'Dhaka' } },
      { ...base, title: 'Concert', slug: 'b', venue: { name: 'Hamlet Arena', city: 'Dhaka' } },
      { ...base, title: 'Comedy', slug: 'c', venue: { name: 'Club', city: 'Hamletville' } },
      { ...base, title: 'Unrelated', slug: 'd', venue: { name: 'Club', city: 'Sylhet' } },
    ]);
    const search = await request(app).get('/api/events?q=hamlet');
    expect(titles(search).sort()).toEqual(['Comedy', 'Concert', 'Hamlet']);

    // a cursor must narrow the search, not replace it
    await Event.insertMany(
      Array.from({ length: 30 }, (_, i) => ({
        ...base,
        title: `Hamlet ${i}`,
        slug: `hamlet-${i}`,
        venue: { name: 'Hall', city: 'Dhaka' },
      })),
    );
    const first = await request(app).get('/api/events?q=hamlet');
    const second = await request(app).get(`/api/events?q=hamlet&cursor=${first.body.nextCursor}`);
    expect(first.body.items.length + second.body.items.length).toBe(33);
    expect(titles(second)).not.toContain('Unrelated');
  });

  it('filters by category, city and date; search text is literal', async () => {
    const org = await makeOrganizer();
    const [d5, d9] = [inDays(5), inDays(9)];
    await makePublished(org.token, {
      title: 'Dhaka Play',
      category: 'theatre',
      startsAt: hours(d5, 0),
      endsAt: hours(d5, 2),
    });
    await makePublished(org.token, {
      title: 'Sylhet Gig',
      category: 'concert',
      venue: { name: 'Stadium', city: 'Sylhet' },
      startsAt: hours(d9, 0),
      endsAt: hours(d9, 2),
    });

    const get = (query: string) => request(app).get(`/api/events?${query}`);
    expect(titles(await get('category=concert'))).toEqual(['Sylhet Gig']);
    expect(titles(await get('city=dhaka'))).toEqual(['Dhaka Play']);
    expect(titles(await get(`from=${encodeURIComponent(inDays(7).toISOString())}`))).toEqual([
      'Sylhet Gig',
    ]);
    expect(titles(await get(`to=${encodeURIComponent(inDays(7).toISOString())}`))).toEqual([
      'Dhaka Play',
    ]);
    expect(titles(await get(`q=${encodeURIComponent('.*')}`))).toEqual([]);
    expect((await get('category=nope')).status).toBe(400);
  });
});

describe('public event page', () => {
  it('shows a published event to guests, with the organizer name', async () => {
    const org = await makeOrganizer('Nadia');
    const event = await makePublished(org.token, { description: 'Full text' });
    const res = await request(app).get(`/api/events/${event.slug.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id: event.id,
      description: 'Full text',
      organizerName: 'Nadia Productions',
      phase: 'on_sale',
    });
    expect(res.body.event).not.toHaveProperty('organizerId');
    expect(res.body.event).not.toHaveProperty('counters');
  });

  it('shows a draft only to its owner and admins (FR-EVT-08)', async () => {
    const owner = await makeOrganizer();
    const other = await makeOrganizer();
    const admin = await makeAdmin();
    const draft = await makeDraft(owner.token);
    const url = `/api/events/${draft.slug}`;

    expect((await request(app).get(url)).status).toBe(404);
    expect((await as(other.token).get(url)).status).toBe(404);
    expect((await as(owner.token).get(url)).status).toBe(200);
    expect((await as(admin.token).get(url)).status).toBe(200);
  });

  it('an unknown slug → 404; an expired token → 401, so the client refreshes', async () => {
    const org = await makeOrganizer();
    const event = await makePublished(org.token);
    expect((await request(app).get('/api/events/nothing-here')).status).toBe(404);

    const expired = jwt.sign({ sid: 'x' }, env.JWT_ACCESS_SECRET, {
      subject: org.user.id,
      expiresIn: -10,
    });
    expect((await as(expired).get(`/api/events/${event.slug}`)).status).toBe(401);
  });
});

describe('admin', () => {
  it('lists events of every organizer, filtered and paginated', async () => {
    const admin = await makeAdmin();
    const a = await makeOrganizer('A');
    const b = await makeOrganizer('B');
    await makeDraft(a.token, { title: 'From A' });
    await makePublished(b.token, { title: 'From B' });

    const titles = async (query = '') => {
      const res = await as(admin.token).get(`/api/admin/events${query}`);
      expect(res.status).toBe(200);
      return res.body.items.map((e: { title: string }) => e.title).sort() as string[];
    };
    expect(await titles()).toEqual(['From A', 'From B']);
    expect(await titles('?status=published')).toEqual(['From B']);
    expect(await titles(`?organizerId=${a.user.id}`)).toEqual(['From A']);

    const { startsAt, endsAt } = eventInput();
    await Event.insertMany(
      Array.from({ length: 50 }, (_, i) => ({
        organizerId: a.user.id,
        title: `Bulk ${i}`,
        slug: `bulk-${i}`,
        venue: { name: 'Hall', city: 'Dhaka' },
        timezone: 'UTC',
        startsAt,
        endsAt,
      })),
    );
    const first = await as(admin.token).get('/api/admin/events');
    expect(first.body.items).toHaveLength(50);
    const second = await as(admin.token).get(`/api/admin/events?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });

  it('cannot demote an organizer with live sales, but can demote one without (FR-ADM-02)', async () => {
    const admin = await makeAdmin();
    const seller = await makeOrganizer('Seller');
    const event = await makePublished(seller.token);
    await Event.updateOne({ _id: event.id }, { $set: { 'counters.seatsSold': 3 } });

    const blocked = await as(admin.token)
      .patch(`/api/admin/users/${seller.user.id}`)
      .send({ role: 'attendee' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ORGANIZER_HAS_LIVE_EVENTS');

    const quiet = await makeOrganizer('Quiet');
    await makePublished(quiet.token);
    const ok = await as(admin.token)
      .patch(`/api/admin/users/${quiet.user.id}`)
      .send({ role: 'attendee' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('attendee');
  });
});
