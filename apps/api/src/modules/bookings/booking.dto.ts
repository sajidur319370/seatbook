import type { BookingDto } from '@seatbook/shared';
import { Ticket, type BookingLean } from '../../db/models';
import { bySeat, toBookedEventDto, toTicketSummaryDto } from './bookings.service';

/** Explicit mapper: ids as strings, dates as ISO, and nothing internal (no chargeId, no code hash). */
export async function bookingDto(b: BookingLean): Promise<BookingDto> {
  // queries.md §12.2: scoped to the owner too, never by bookingId alone.
  const tickets = await Ticket.find({ bookingId: b._id, userId: b.userId })
    .select('_id seatLabel sectionName row number tierName price status checkedInAt')
    .lean();
  tickets.sort(bySeat);

  return {
    id: String(b._id),
    reference: b.reference,
    status: b.status === 'cancelled' ? 'cancelled' : 'confirmed',
    event: toBookedEventDto(b),
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
    tickets: tickets.map(toTicketSummaryDto),
    createdAt: b.createdAt.toISOString(),
  };
}
