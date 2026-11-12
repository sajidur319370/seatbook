import { Booking, Hold, Seat, Ticket } from '../db/models';
import { repairCounters } from './counters';

/**
 * queries.md §16.2 · NFR-REL-03 · TR-10. Questions the database must always answer "none" to.
 * Run after the seed, after the load test, and on a restored backup: races that slipped past the
 * unit tests show up here.
 */
export async function checkInvariants() {
  const [v1, v2, v3, v4, v5, v6] = await Promise.all([
    // V1: a booked seat without exactly one live ticket of the same booking
    Seat.aggregate([
      { $match: { status: 'booked' } },
      { $lookup: { from: 'tickets', localField: '_id', foreignField: 'seatKey', as: 'live' } },
      {
        $match: {
          $expr: {
            $or: [
              { $ne: [{ $size: '$live' }, 1] },
              { $ne: [{ $first: '$live.bookingId' }, '$bookingId'] },
            ],
          },
        },
      },
      { $project: { label: 1, eventId: 1, liveTickets: { $size: '$live' } } },
    ]),
    // V2: a live ticket whose seat isn't booked by its booking
    Ticket.aggregate([
      { $match: { seatKey: { $type: 'objectId' } } },
      { $lookup: { from: 'seats', localField: 'seatId', foreignField: '_id', as: 'seat' } },
      {
        $match: {
          $expr: {
            $or: [
              { $ne: [{ $first: '$seat.status' }, 'booked'] },
              { $ne: [{ $first: '$seat.bookingId' }, '$bookingId'] },
            ],
          },
        },
      },
      { $project: { seatLabel: 1, eventId: 1, bookingId: 1 } },
    ]),
    // V3: a seat still held by a hold that was converted or released (a write-order bug)
    Seat.aggregate([
      { $match: { status: 'held' } },
      { $lookup: { from: 'holds', localField: 'holdId', foreignField: '_id', as: 'hold' } },
      { $match: { 'hold.status': { $in: ['converted', 'released'] } } },
      { $project: { label: 1, eventId: 1, holdId: 1 } },
    ]),
    // V4: two active holds for one (event, user): impossible by the partial unique index
    Hold.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: { eventId: '$eventId', userId: '$userId' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]),
    // V5: a booking whose total isn't the sum of its items
    Booking.aggregate([
      { $match: { $expr: { $ne: ['$total', { $sum: '$items.price' }] } } },
      { $project: { reference: 1, total: 1 } },
    ]),
    // V6: display counters that drifted from the aggregates (dry run of repair:counters)
    repairCounters({ apply: false }),
  ]);

  const all = { v1, v2, v3, v4, v5, v6 } as Record<string, unknown[]>;
  const counts = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]));
  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    samples: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.slice(0, 3)])),
  };
}
