import QRCode from 'qrcode';
import type { Types } from 'mongoose';
import type {
  BookedEventDto,
  BookingListItemDto,
  MyBookingsResponse,
  MyTicketsResponse,
  TicketResponse,
  TicketStatus,
  TicketSummaryDto,
} from '@seatbook/shared';
import { Booking, Ticket, type BookingLean, type TicketLean } from '../../db/models';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { formatManualCode, manualCode, qrCode } from '../../lib/ticketCodes';
import type { Ctx } from '../../types/ctx';
import { findMyBooking, findMyTicket } from './scope';

const PAGE = 20;
/** Tonight's tickets stay in "Upcoming" while the show is on (queries.md §12.3). */
const SHOW_GRACE_MS = 6 * 3_600_000;

export const toBookedEventDto = (b: Pick<BookingLean, 'eventId' | 'event'>): BookedEventDto => ({
  id: String(b.eventId),
  title: b.event.title,
  slug: b.event.slug,
  startsAt: b.event.startsAt.toISOString(),
  venueName: b.event.venueName,
  city: b.event.city,
  timezone: b.event.timezone,
});

type SummaryRow = Pick<
  TicketLean,
  | '_id'
  | 'seatLabel'
  | 'sectionName'
  | 'row'
  | 'number'
  | 'tierName'
  | 'price'
  | 'status'
  | 'checkedInAt'
>;

export const toTicketSummaryDto = (t: SummaryRow): TicketSummaryDto => ({
  id: String(t._id),
  seatLabel: t.seatLabel,
  sectionName: t.sectionName,
  row: t.row,
  number: t.number,
  tierName: t.tierName,
  price: t.price,
  status: t.status as TicketStatus,
  checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
});

/** Numeric, like the hold list: A2 before A10. */
export const bySeat = (a: { seatLabel: string }, b: { seatLabel: string }) =>
  a.seatLabel.localeCompare(b.seatLabel, undefined, { numeric: true });

/** queries.md §12.1 (AP13): newest first, cursor over (createdAt, _id). */
export async function listMyBookings(ctx: Ctx, cursor?: string): Promise<MyBookingsResponse> {
  const filter: Record<string, unknown> = { userId: ctx.userId };
  if (cursor) {
    const { t, id } = decodeCursor(cursor);
    filter.$or = [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: id } }];
  }
  const rows = await Booking.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE + 1)
    .select('reference eventId event items total currency status createdAt')
    .lean<BookingLean[]>();
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((b): BookingListItemDto => ({
      id: String(b._id),
      reference: b.reference,
      status: b.status === 'cancelled' ? 'cancelled' : 'confirmed',
      event: toBookedEventDto(b),
      seats: b.items.length,
      total: b.total,
      currency: b.currency,
      createdAt: b.createdAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE ? encodeCursor(page.at(-1)!) : null,
  };
}

/** queries.md §12.3 (AP14), grouped by event. The event details come from the bookings' snapshots. */
export async function listMyTickets(
  ctx: Ctx,
  when: 'upcoming' | 'past',
  now = ctx.now(),
): Promise<MyTicketsResponse> {
  const cutoff = new Date(now.getTime() - SHOW_GRACE_MS);
  const rows = await Ticket.find({
    userId: ctx.userId,
    status: { $ne: 'void' },
    eventStartsAt: when === 'upcoming' ? { $gte: cutoff } : { $lt: cutoff },
  })
    .sort({ eventStartsAt: when === 'upcoming' ? 1 : -1 })
    .limit(200)
    .select(
      'eventId bookingId eventStartsAt seatLabel sectionName row number tierName price status checkedInAt',
    )
    .lean<(SummaryRow & Pick<TicketLean, 'eventId' | 'bookingId'>)[]>();

  const bookingIds = [...new Set(rows.map((t) => String(t.bookingId)))];
  const bookings = await Booking.find({ _id: { $in: bookingIds }, userId: ctx.userId })
    .select('eventId event')
    .lean<Pick<BookingLean, '_id' | 'eventId' | 'event'>[]>();
  const eventOf = new Map(bookings.map((b) => [String(b.eventId), toBookedEventDto(b)]));

  // The rows arrive sorted by event date, so the groups come out in that order too.
  const groups = new Map<string, MyTicketsResponse['groups'][number]>();
  for (const t of rows) {
    const key = String(t.eventId);
    const event = eventOf.get(key);
    if (!event) continue;
    if (!groups.has(key)) groups.set(key, { event, tickets: [] });
    groups.get(key)!.tickets.push(toTicketSummaryDto(t));
  }
  for (const g of groups.values()) g.tickets.sort(bySeat);
  return { groups: [...groups.values()] };
}

/** queries.md §12.4 (FR-TKT-06): the only response that carries a ticket's codes. */
export async function myTicket(ctx: Ctx, ticketId: Types.ObjectId): Promise<TicketResponse> {
  const t = await findMyTicket(ctx, ticketId);
  const booking = await findMyBooking(ctx, t.bookingId);
  const live = t.status !== 'void';
  const code = live ? qrCode(t._id, t.eventId) : null; // only inside the image, never logged
  return {
    ticket: {
      ...toTicketSummaryDto(t),
      eventId: String(t.eventId),
      bookingId: String(t.bookingId),
      eventTitle: t.eventTitle,
      eventStartsAt: t.eventStartsAt.toISOString(),
      currency: booking.currency,
      holderName: t.holderName,
    },
    qrDataUrl: code
      ? await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      : null,
    manualCode: live ? formatManualCode(manualCode(t._id)) : null,
    event: toBookedEventDto(booking),
  };
}
