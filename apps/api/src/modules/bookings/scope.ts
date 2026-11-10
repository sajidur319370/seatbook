import type { Types } from 'mongoose';
import { Booking, Ticket, type BookingLean, type TicketLean } from '../../db/models';
import { notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';

/**
 * schema.md §3: attendee routes load bookings and tickets ONLY through these. "Not mine" and
 * "doesn't exist" give the same 404 (NFR-SEC-02), and admins get no bypass.
 */
export async function findMyBooking(ctx: Ctx, bookingId: Types.ObjectId) {
  const b = await Booking.findOne({ _id: bookingId, userId: ctx.userId }).lean<BookingLean>();
  if (!b) throw notFound();
  return b;
}

export async function findMyTicket(ctx: Ctx, ticketId: Types.ObjectId) {
  const t = await Ticket.findOne({ _id: ticketId, userId: ctx.userId }).lean<TicketLean>();
  if (!t) throw notFound();
  return t;
}
