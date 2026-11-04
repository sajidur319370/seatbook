import type { Types } from 'mongoose';
import type { SeatMapResponse, SeatStatus, TierDto } from '@seatbook/shared';
import { Event, SEAT_MAP_FIELDS, Seat, type EventLean } from '../../db/models';
import { notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';
import { toPublicEventDto, toSeatMapDto } from './event.dto';
import { publicEventFilter } from './scope';

type SeatRow = {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  row: string;
  number: number;
  x: number;
  y: number;
  tierId: Types.ObjectId;
  status: SeatStatus;
  version: number;
  holdExpiresAt: Date | null;
};

/** queries.md §7: GET /events/:eventId/seats (FR-VIEW-01). */
export async function loadSeatMap(
  ctx: Ctx | null,
  eventId: Types.ObjectId,
): Promise<SeatMapResponse> {
  const ev = await Event.findOne({ _id: eventId, ...publicEventFilter(ctx) })
    .select('-description') // the DTO needs the rest
    .lean<EventLean>();
  if (!ev) throw notFound();

  const now = new Date();
  const seats = await Seat.find({ eventId: ev._id }).select(SEAT_MAP_FIELDS).lean<SeatRow[]>();
  const { stageLabel, sections, tiers } = toSeatMapDto(ev);

  const sectionIndex = new Map(sections.map((s, i) => [s._id, i]));
  const tierIndex = new Map(tiers.map((t, i) => [t._id, i]));

  return {
    serverTime: now.toISOString(),
    event: toPublicEventDto(ev, now),
    layout: { stageLabel, sections },
    tiers,
    seats: seats.map((s) => {
      const expired = s.status === 'held' && s.holdExpiresAt! <= now; // lazy expiry (FR-EXP-01)
      return {
        id: String(s._id),
        s: sectionIndex.get(String(s.sectionId))!,
        r: s.row,
        n: s.number,
        x: s.x,
        y: s.y,
        t: tierIndex.get(String(s.tierId))!,
        st: expired ? 'available' : s.status,
        v: s.version,
        ...(s.status === 'held' && !expired && { exp: s.holdExpiresAt!.toISOString() }),
      };
    }),
  };
}

/** queries.md §6.2: the event page's tiers with remaining seats (FR-EVT-08). */
export async function tiersWithRemaining(ev: EventLean): Promise<TierDto[]> {
  const now = new Date();
  const remaining = await Seat.aggregate<{ _id: Types.ObjectId; remaining: number }>([
    {
      $match: {
        eventId: ev._id,
        $or: [{ status: 'available' }, { status: 'held', holdExpiresAt: { $lte: now } }], // lazy expiry
      },
    },
    { $group: { _id: '$tierId', remaining: { $sum: 1 } } },
  ]);
  const byTier = new Map(remaining.map((r) => [String(r._id), r.remaining]));
  return ev.tiers.map((t) => ({
    id: String(t._id),
    name: t.name,
    price: t.price,
    color: t.color,
    remaining: byTier.get(String(t._id)) ?? 0,
  }));
}
