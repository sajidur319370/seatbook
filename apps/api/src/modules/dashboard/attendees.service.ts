import type { Types } from 'mongoose';
import {
  BOOKING_REFERENCE,
  type AttendeeListResponse,
  type AttendeeRow,
  type TicketStatus,
} from '@seatbook/shared';
import { Booking, Ticket } from '../../db/models';
import { oid } from '../../lib/ids';
import { escapeRegex } from '../../lib/regex';

const PAGE = 50;

type Row = {
  _id: Types.ObjectId;
  holderName: string;
  seatLabel: string;
  sectionName: string;
  tierName: string;
  status: TicketStatus;
  checkedInAt: Date | null;
  booking: { reference: string; buyer: { email: string } };
};

const toAttendeeRow = (r: Row): AttendeeRow => ({
  ticketId: String(r._id),
  holderName: r.holderName,
  email: r.booking.buyer.email,
  reference: r.booking.reference,
  seatLabel: r.seatLabel,
  sectionName: r.sectionName,
  tierName: r.tierName,
  status: r.status,
  checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
});

/**
 * queries.md §15 · FR-DASH-06. Search covers name, seat, booking reference and email prefix. Email
 * and reference live on the booking, so one event-scoped booking query finds those first.
 * The eventId comes from the route's ownership check.
 */
export async function attendeeList(
  eventId: Types.ObjectId,
  q: { q?: string; cursor?: string },
): Promise<AttendeeListResponse> {
  const filter: Record<string, unknown> = { eventId, status: { $ne: 'void' } };
  const term = q.q?.trim();
  if (term) {
    const ref = term.toUpperCase();
    const bookings = await Booking.find({
      eventId,
      $or: [
        ...(BOOKING_REFERENCE.test(ref) ? [{ reference: ref }] : []),
        // Anchored prefix on an already-lowercased field, inside one event: cheap without an index.
        { 'buyer.email': { $regex: `^${escapeRegex(term.toLowerCase())}` } },
      ],
    })
      .select('_id')
      .limit(100)
      .lean();
    const rx = { $regex: escapeRegex(term), $options: 'i' }; // ≤ 5,000 tickets per event
    filter.$or = [
      { holderName: rx },
      { seatLabel: rx },
      ...(bookings.length ? [{ bookingId: { $in: bookings.map((x) => x._id) } }] : []),
    ];
  }
  if (q.cursor) filter._id = { $gt: oid(q.cursor) };

  const rows = await Ticket.aggregate<Row>([
    { $match: filter },
    { $sort: { _id: 1 } }, // { eventId, _id }
    { $limit: PAGE + 1 },
    {
      // ONE lookup for the page, projected to two fields: not 50 extra queries.
      $lookup: {
        from: 'bookings',
        localField: 'bookingId',
        foreignField: '_id',
        pipeline: [{ $project: { reference: 1, 'buyer.email': 1 } }],
        as: 'booking',
      },
    },
    { $unwind: '$booking' },
    {
      $project: {
        holderName: 1,
        seatLabel: 1,
        sectionName: 1,
        tierName: 1,
        status: 1,
        checkedInAt: 1,
        booking: 1,
      },
    },
  ]);
  const page = rows.slice(0, PAGE);
  return {
    items: page.map(toAttendeeRow),
    nextCursor: rows.length > PAGE ? String(page.at(-1)!._id) : null,
  };
}
