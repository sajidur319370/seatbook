import type { BookingDto, TicketStatus } from '@seatbook/shared';
import { Ticket, type BookingLean } from '../../db/models';

/** Explicit mapper: ids as strings, dates as ISO, and nothing internal (no chargeId, no code hash). */
export async function bookingDto(b: BookingLean): Promise<BookingDto> {
  const tickets = await Ticket.find({ bookingId: b._id })
    .select('_id seatLabel sectionName row number tierName price status checkedInAt')
    .lean();
  // Numeric, like the hold list: A2 before A10.
  tickets.sort((a, b) => a.seatLabel.localeCompare(b.seatLabel, undefined, { numeric: true }));

  return {
    id: String(b._id),
    reference: b.reference,
    status: b.status === 'cancelled' ? 'cancelled' : 'confirmed',
    event: {
      id: String(b.eventId),
      title: b.event.title,
      slug: b.event.slug,
      startsAt: b.event.startsAt.toISOString(),
      venueName: b.event.venueName,
      city: b.event.city,
      timezone: b.event.timezone,
    },
    items: b.items.map((i) => ({
      seatId: String(i.seatId),
      label: i.label,
      sectionName: i.sectionName,
      row: i.row,
      number: i.number,
      tierName: i.tierName,
      price: i.price,
    })),
    total: b.total,
    currency: b.currency,
    payment: {
      brand: b.payment.brand,
      last4: b.payment.last4,
      paidAt: b.payment.paidAt.toISOString(),
    },
    tickets: tickets.map((t) => ({
      id: String(t._id),
      seatLabel: t.seatLabel,
      sectionName: t.sectionName,
      row: t.row,
      number: t.number,
      tierName: t.tierName,
      price: t.price,
      status: t.status as TicketStatus,
      checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
    })),
    createdAt: b.createdAt.toISOString(),
  };
}
