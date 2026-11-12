import type { Types } from 'mongoose';
import { Booking, Event, Seat, Ticket } from '../db/models';

/**
 * queries.md §16.1 · data-model.md D8. `events.counters` are DISPLAY copies, bumped after commit
 * (events/counters.ts) and therefore repairable: this recounts them from the source of truth.
 * Dry run by default; `apply: true` writes. Returns every difference it found (or fixed).
 */
export type CounterDrift = {
  eventId: Types.ObjectId;
  field: CounterField;
  stored: number;
  actual: number;
};

const FIELDS = ['seatsTotal', 'seatsSellable', 'seatsSold', 'ticketsCheckedIn', 'revenue'] as const;
type CounterField = (typeof FIELDS)[number];

export async function repairCounters(o: { apply: boolean }): Promise<CounterDrift[]> {
  const drift: CounterDrift[] = [];
  const events = Event.find({ status: { $ne: 'draft' } }) // drafts have no seats or sales yet
    .select('_id counters')
    .lean()
    .cursor();

  for await (const ev of events) {
    const [[seats], sold, checkedIn, [rev]] = await Promise.all([
      Seat.aggregate<{ total: number; sellable: number }>([
        { $match: { eventId: ev._id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sellable: { $sum: { $cond: [{ $ne: ['$status', 'blocked'] }, 1, 0] } },
          },
        },
      ]),
      Ticket.countDocuments({ eventId: ev._id, status: { $in: ['issued', 'checked_in'] } }),
      Ticket.countDocuments({ eventId: ev._id, status: 'checked_in' }),
      Booking.aggregate<{ r: number }>([
        { $match: { eventId: ev._id, status: 'confirmed' } },
        { $group: { _id: null, r: { $sum: '$total' } } },
      ]),
    ]);
    const actual: Record<CounterField, number> = {
      seatsTotal: seats?.total ?? 0,
      seatsSellable: seats?.sellable ?? 0,
      seatsSold: sold,
      ticketsCheckedIn: checkedIn,
      revenue: rev?.r ?? 0,
    };
    const stored = (ev.counters ?? {}) as Partial<Record<CounterField, number>>;
    const diffs = FIELDS.filter((f) => (stored[f] ?? 0) !== actual[f]);
    for (const f of diffs)
      drift.push({ eventId: ev._id, field: f, stored: stored[f] ?? 0, actual: actual[f] });
    if (o.apply && diffs.length) {
      await Event.updateOne({ _id: ev._id }, { $set: { counters: actual } });
    }
  }
  return drift;
}
