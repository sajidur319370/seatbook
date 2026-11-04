import {
  eventPhase,
  type OrganizerEventDto,
  type PublicEventDto,
  type SeatMapDto,
} from '@seatbook/shared';
import type { EventLean } from '../../db/models';

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

export function toPublicEventDto(
  e: EventLean,
  now = new Date(),
  extra: Partial<PublicEventDto> = {},
): PublicEventDto {
  const prices = (e.tiers ?? []).map((t) => t.price);
  return {
    id: String(e._id),
    slug: e.slug,
    title: e.title,
    summary: e.summary ?? '',
    category: e.category,
    venue: e.venue,
    timezone: e.timezone,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    salesStartAt: iso(e.salesStartAt),
    salesEndAt: iso(e.salesEndAt),
    currency: e.currency,
    maxSeatsPerOrder: e.maxSeatsPerOrder,
    coverColor: e.coverColor,
    phase: eventPhase(e, now),
    soldOut:
      e.status === 'published' &&
      e.counters.seatsSellable > 0 &&
      e.counters.seatsSold >= e.counters.seatsSellable,
    lowestPrice: prices.length ? Math.min(...prices) : null,
    ...extra,
  };
}

export const toSeatMapDto = (e: EventLean): SeatMapDto => ({
  stageLabel: e.seatMap?.stageLabel ?? 'STAGE',
  sections: (e.seatMap?.sections ?? []).map((s) => ({
    ...s,
    _id: String(s._id),
    rows: s.rows.map((r) => ({ ...r, tierId: String(r.tierId) })),
  })),
  tiers: (e.tiers ?? []).map((t) => ({ ...t, _id: String(t._id) })),
});

export function toOrganizerEventDto(e: EventLean, now = new Date()): OrganizerEventDto {
  return {
    ...toPublicEventDto(e, now, { description: e.description }),
    status: e.status,
    revision: e.revision,
    refundsAllowed: e.refundsAllowed,
    counters: e.counters,
    seatMap: toSeatMapDto(e),
  };
}
