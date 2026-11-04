import type { Types } from 'mongoose';
import type { SeatMapInput } from '@seatbook/shared';
import { Event, type EventLean } from '../../db/models';
import { conflict } from '../../lib/errors';
import { findOwnedEvent } from '../events/scope';
import type { Ctx } from '../../types/ctx';

/** queries.md §5.2: draft only, CAS on revision. Validation already ran (seatMapInputSchema in the route). */
export async function saveSeatMap(ctx: Ctx, eventId: Types.ObjectId, input: SeatMapInput) {
  const updated = await Event.findOneAndUpdate(
    { _id: eventId, organizerId: ctx.userId, status: 'draft', revision: input.expectedRevision },
    {
      $set: {
        'seatMap.stageLabel': input.stageLabel,
        'seatMap.sections': input.sections,
        tiers: input.tiers,
      },
      $inc: { revision: 1 },
    },
    { new: true, runValidators: true },
  ).lean<EventLean>();
  if (updated) return updated;

  const ev = await findOwnedEvent(ctx, eventId, 'status revision');
  if (ev.status !== 'draft')
    throw conflict('EVENT_NOT_DRAFT', 'The seat map is locked after publishing.'); // AC-EVT-03
  throw conflict('STALE_DRAFT', 'This event was changed in another tab.', {
    revision: ev.revision,
  });
}
