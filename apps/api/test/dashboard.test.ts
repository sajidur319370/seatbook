import { beforeEach, describe, expect, it } from 'vitest';
import type { EventDashboardDto } from '@seatbook/shared';
import { Event } from '../src/db/models';
import {
  DASHBOARD_EVENT_FIELDS,
  eventDashboard,
  type DashboardEvent,
} from '../src/modules/dashboard/dashboard.service';
import { findOwnedEvent } from '../src/modules/events/scope';
import expected from './fixtures/dashboard.expected.json';
import { buildDashboardFixture, ny } from './fixtures/dashboardFixture';

const comparable = (d: EventDashboardDto) => ({
  kpi: d.kpi,
  salesPerDay: d.salesPerDay,
  tiers: d.tiers.map(({ tierId: _ignored, ...rest }) => rest),
  checkinsOverTime: d.checkinsOverTime,
});

describe('event dashboard (AC-DASH-01..02, TR-09)', () => {
  let f: Awaited<ReturnType<typeof buildDashboardFixture>>;
  const dashboardAt = async (now: Date) =>
    eventDashboard(
      await findOwnedEvent<DashboardEvent>(f.orgCtx, f.eventId, DASHBOARD_EVENT_FIELDS),
      now,
    );

  beforeEach(async () => {
    f = await buildDashboardFixture(); // the global beforeEach clears the DB first
  }, 60_000);

  it('matches the hand-calculated fixture (AC-DASH-01)', async () => {
    const d = await dashboardAt(new Date('2030-06-15T12:00:00Z'));
    expect(comparable(d)).toEqual(expected);
    // Tier revenue sums tickets.price; total revenue sums bookings.total. They must agree (V5).
    expect(d.tiers.reduce((n, t) => n + t.revenue, 0)).toBe(d.kpi.revenue);
  });

  it('aggregates; it never reads the display counters (which miss the cancellation)', async () => {
    const ev = (await Event.findById(f.eventId).lean())!;
    expect(ev.counters.seatsSold).toBe(13); // the cancelled booking's 2 seats are still counted
    expect((await dashboardAt(new Date('2030-06-15T12:00:00Z'))).kpi.sold).toBe(11);
  });

  it('counts only holds that are still live', async () => {
    expect((await dashboardAt(ny('2030-06-14T11:55'))).kpi.heldNow).toBe(1);
    // Expired at exactly 12:00, with no sweeper run: lazy expiry in the count itself.
    expect((await dashboardAt(ny('2030-06-14T12:00'))).kpi.heldNow).toBe(0);
  });

  it("buckets days in the event's time zone (AC-DASH-02)", async () => {
    // Dhaka is UTC+6: the 23:30 New York booking is 09:30 the next morning there.
    await Event.updateOne({ _id: f.eventId }, { $set: { timezone: 'Asia/Dhaka' } });
    const d = await dashboardAt(new Date('2030-06-15T12:00:00Z'));
    expect(d.salesPerDay.map((r) => [r.day, r.tickets])).toEqual([
      ['2030-06-10', 2],
      ['2030-06-11', 3],
      ['2030-06-12', 2],
      ['2030-06-13', 3],
      ['2030-06-14', 1],
    ]);
    expect(d.kpi).toEqual(expected.kpi); // the time zone changes days, never totals
  });

  it('before sales end, the days stop at today', async () => {
    const d = await dashboardAt(ny('2030-06-12T18:00'));
    expect(d.salesPerDay.map((r) => r.day)).toEqual(['2030-06-10', '2030-06-11', '2030-06-12']);
    expect(d.event.phase).toBe('on_sale');
  });
});
