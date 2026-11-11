import { beforeEach, describe, expect, it } from 'vitest';
import { eventPhase, EVENT_PHASES, type EventPhase } from '@seatbook/shared';
import { Event, User } from '../src/db/models';
import { adminOverview } from '../src/modules/dashboard/overview.service';
import { as } from './helpers/auth';
import { makeBuyers } from './helpers/buyers';
import { holdSeats, pay } from './helpers/checkout';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import { makeDraft, makePublishedEvent } from './factories/events';

const H = 3_600_000;
const DAY = 24 * H;

describe('organizer overview (FR-DASH-09)', () => {
  it('counts only my own events, with revenue per currency', async () => {
    const nadia = await makeOrganizer('Nadia');
    const karim = await makeOrganizer('Karim');
    const mine = await makePublishedEvent(nadia.token); // BDT, 4000 a seat
    const theirs = await makePublishedEvent(karim.token);
    const [rafi, mina] = await makeBuyers(2);
    await holdSeats(rafi!.token, mine.eventId, [mine.seats[0]!.id, mine.seats[1]!.id]);
    await pay(rafi!.token, mine.eventId);
    await holdSeats(mina!.token, theirs.eventId, [theirs.seats[0]!.id]);
    await pay(mina!.token, theirs.eventId);

    const res = await as(nadia.token).get('/api/organizer/overview');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      ticketsSold: 2,
      eventsOnSale: 1,
      revenue: [{ currency: 'BDT', amount: 8000 }],
    });
    expect(res.body.upcoming.map((e: { id: string }) => e.id)).toEqual([mine.eventId]);
    expect(res.body.upcoming[0]).toMatchObject({ phase: 'on_sale', sold: 2, revenue: 8000 });
    expect(res.body.last30Days).toHaveLength(30);
    expect(res.body.last30Days.at(-1).tickets).toBe(2); // today, in my profile's zone
  });

  it('an organizer with nothing sees zeros, not an error', async () => {
    const res = await as((await makeOrganizer()).token).get('/api/organizer/overview');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ ticketsSold: 0, eventsOnSale: 0, revenue: [] });
  });
});

describe('admin overview (FR-DASH-10)', () => {
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  beforeEach(async () => {
    admin = await makeAdmin();
  });

  it('counts users by role, plus suspended', async () => {
    await makeOrganizer();
    const [a] = await makeBuyers(2);
    await User.updateOne({ _id: a!.user.id }, { $set: { suspendedAt: new Date() } });
    const res = await as(admin.token).get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual({ attendee: 2, organizer: 1, admin: 1, suspended: 1 });
    expect(res.body.ticketsPerDay).toHaveLength(30);
  });

  it("the pipeline's phase ($switch) agrees with eventPhase() for every phase", async () => {
    const org = await makeOrganizer();
    const now = new Date();
    const at = (ms: number) => new Date(now.getTime() + ms);
    const shapes: Record<Exclude<EventPhase, 'draft'>, object> = {
      scheduled: { salesStartAt: at(DAY), startsAt: at(5 * DAY), endsAt: at(5 * DAY + 3 * H) },
      on_sale: { salesStartAt: at(-DAY), startsAt: at(5 * DAY), endsAt: at(5 * DAY + 3 * H) },
      sales_closed: {
        salesStartAt: at(-DAY),
        salesEndAt: at(-H),
        startsAt: at(H),
        endsAt: at(4 * H),
      },
      ended: { salesStartAt: at(-9 * DAY), startsAt: at(-5 * H), endsAt: at(-2 * H) },
      cancelled: { status: 'cancelled', startsAt: at(DAY), endsAt: at(DAY + H) },
    };
    await makeDraft(org.token); // draft
    for (const shape of Object.values(shapes)) {
      const e = await makeDraft(org.token);
      await Event.updateOne(
        { _id: e.id },
        { $set: { status: 'published', salesEndAt: null, ...shape } },
      );
    }
    // A published event with NO salesStartAt (an old one) must not count as scheduled.
    const e = await makeDraft(org.token);
    await Event.updateOne(
      { _id: e.id },
      { $set: { status: 'published', salesStartAt: null, startsAt: at(DAY), endsAt: at(DAY + H) } },
    );

    const fromJs = Object.fromEntries(EVENT_PHASES.map((p) => [p, 0]));
    for (const ev of await Event.find().lean()) {
      const e = { ...ev, salesStartAt: ev.salesStartAt ?? null, salesEndAt: ev.salesEndAt ?? null };
      fromJs[eventPhase(e, now)]! += 1;
    }
    const { eventsByPhase } = await adminOverview(now);
    expect(eventsByPhase).toEqual(fromJs);
    expect(eventsByPhase).toMatchObject({ draft: 1, on_sale: 2, scheduled: 1, ended: 1 });
  });

  it('GMV is per currency, and only confirmed bookings count', async () => {
    const org = await makeOrganizer();
    const ev = await makePublishedEvent(org.token);
    const [rafi] = await makeBuyers(1);
    await holdSeats(rafi!.token, ev.eventId, [ev.seats[0]!.id]);
    await pay(rafi!.token, ev.eventId);
    const res = await as(admin.token).get('/api/admin/overview');
    expect(res.body.gmv).toEqual([{ currency: 'BDT', revenue: 4000, bookings: 1 }]);
    expect(res.body.ticketsPerDay.at(-1).tickets).toBe(1);
  });

  it("an organizer can't read another organizer's sales through the admin route (403)", async () => {
    const owner = await makeOrganizer('Owner');
    const snoop = await makeOrganizer('Snoop');
    const ev = await makePublishedEvent(owner.token);
    const res = await as(snoop.token).get(`/api/admin/events/${ev.eventId}/dashboard`);
    expect(res.status).toBe(403);
    expect(res.body.kpi).toBeUndefined();
  });

  it('an admin can open any event’s dashboard, read-only', async () => {
    const org = await makeOrganizer();
    const ev = await makePublishedEvent(org.token);
    const res = await as(admin.token).get(`/api/admin/events/${ev.eventId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.kpi).toMatchObject({ sold: 0, sellable: 30 });
    // …but not through the organizer route: admins get no ownership bypass (FR-RBAC-04).
    expect(
      (await as(admin.token).get(`/api/organizer/events/${ev.eventId}/dashboard`)).status,
    ).toBe(404);
  });
});
