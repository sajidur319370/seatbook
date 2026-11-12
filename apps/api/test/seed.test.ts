import { describe, expect, it, vi } from 'vitest';
import { eventPhase } from '@seatbook/shared';
import { Booking, Event, OrganizerApplication, Scan, Seat, Ticket, User } from '../src/db/models';
import { muteMail } from '../src/mail/mailer';
import { login } from '../src/modules/auth/auth.service';
import { repairCounters } from '../src/ops/counters';
import { checkInvariants } from '../src/ops/invariants';
import { DEMO, seedDemo } from '../src/ops/seed';
import { payments } from '../src/payments/mockProvider';

/**
 * FR-UI-09 · database.md §10: the demo is built through the real services and must come out
 * consistent. ONE test, because the global hook empties the database before each test.
 */
describe('seed (FR-UI-09)', () => {
  it('builds every demo story, consistently', async () => {
    // The mock charge waits 300 ms "for realism", and the seed makes ~250 purchases with tok_visa
    // only. An instant charge with the same result keeps this test fast.
    vi.spyOn(payments, 'charge').mockImplementation(async (p) => ({
      chargeId: `ch_mock_${p.idempotencyKey}`,
      brand: 'visa',
      last4: '4242',
      amount: p.amount,
      paidAt: new Date(),
    }));
    muteMail();
    const PASSWORD = 'Demo-pass-2026';
    const { people, events } = await seedDemo({ password: PASSWORD });
    const now = new Date();

    // Consistent as built: the services' after-commit counters need no repair.
    expect((await checkInvariants()).counts).toEqual({ v1: 0, v2: 0, v3: 0, v4: 0, v5: 0, v6: 0 });
    expect(await repairCounters({ apply: false })).toEqual([]);

    // People: roles through the real flows; the demo password works.
    expect(await User.countDocuments()).toBe(45); // admin, organizer, 2 attendees, applicant, 40 buyers
    expect((await User.findById(people.admin._id).lean())!.role).toBe('admin');
    expect((await User.findById(people.organizer._id).lean())!.role).toBe('organizer');
    expect(await OrganizerApplication.countDocuments({ status: 'pending' })).toBe(1);
    expect(await OrganizerApplication.countDocuments({ status: 'approved' })).toBe(1);
    const session = await login(
      { email: DEMO('attendee'), password: PASSWORD },
      { ip: '127.0.0.1', userAgent: 'test' },
    );
    expect(session.accessToken).toEqual(expect.any(String));

    // Every phase the demo needs.
    const phaseOf = async (id: unknown) => {
      const e = (await Event.findById(id).lean())!;
      return eventPhase(
        { ...e, salesStartAt: e.salesStartAt ?? null, salesEndAt: e.salesEndAt ?? null },
        now,
      );
    };
    expect(await phaseOf(events.hamlet)).toBe('on_sale');
    expect(await phaseOf(events.jazz)).toBe('on_sale');
    expect(await phaseOf(events.devconf)).toBe('ended');
    expect(await Event.countDocuments({ status: 'draft' })).toBe(1); // the comedy builder demo

    // Sales: roughly the shares in database.md §10, and no holds left behind.
    const soldShare = async (id: unknown) =>
      (await Seat.countDocuments({ eventId: id, status: 'booked' })) /
      (await Seat.countDocuments({ eventId: id, status: { $ne: 'blocked' } }));
    expect(await soldShare(events.hamlet)).toBeGreaterThan(0.35);
    expect(await soldShare(events.hamlet)).toBeLessThan(0.45);
    expect(await soldShare(events.jazz)).toBeGreaterThan(0.9);
    expect(await Seat.countDocuments({ status: 'held' })).toBe(0);

    // Bookings spread over days, not all "today" (createdAt comes from the fake clock).
    const created = (await Booking.find({ eventId: events.hamlet }).select('createdAt').lean()).map(
      (b) => b.createdAt.toISOString().slice(0, 10),
    );
    expect(new Set(created).size).toBeGreaterThan(5);

    // DevConf: ~85 % checked in, 4 duplicate scans, 2 junk codes.
    const devTickets = await Ticket.countDocuments({
      eventId: events.devconf,
      status: { $ne: 'void' },
    });
    const devIn = await Ticket.countDocuments({ eventId: events.devconf, status: 'checked_in' });
    expect(devIn / devTickets).toBeGreaterThan(0.8);
    expect(devIn / devTickets).toBeLessThan(0.9);
    expect(
      await Scan.countDocuments({ eventId: events.devconf, result: 'already_checked_in' }),
    ).toBe(4);
    expect(await Scan.countDocuments({ eventId: events.devconf, result: 'invalid' })).toBe(2);

    // The attendee: 2 upcoming Hamlet tickets and 1 checked-in DevConf ticket; attendee2 none.
    const mine = await Ticket.find({ userId: people.attendee._id }).lean();
    expect(mine.filter((t) => t.eventId.equals(events.hamlet))).toHaveLength(2);
    expect(mine.filter((t) => t.eventId.equals(events.devconf)).map((t) => t.status)).toEqual([
      'checked_in',
    ]);
    expect(await Ticket.countDocuments({ userId: people.attendee2._id })).toBe(0);
  }, 300_000);
});
