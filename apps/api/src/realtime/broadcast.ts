import type { Types } from 'mongoose';
import type { SeatChangeDto } from '@seatbook/shared';
import { Event, type EventLean } from '../db/models';
import type { DomainEvent } from '../events/types';
import { toPublicEventDto } from '../modules/events/event.dto';
import { holdViewForUser } from '../modules/holds/hold.service';
import type { Ctx } from '../types/ctx';
import { getIO, type IO } from './socket';

/** A draft is private again: anyone still watching leaves, except its organizer and admins. */
async function removeViewersOfDraft(io: IO, eventId: Types.ObjectId, organizerId: Types.ObjectId) {
  const room = `event:${eventId}`;
  for (const s of await io.in(room).fetchSockets()) {
    if (s.data.role !== 'admin' && s.data.userId !== String(organizerId)) s.leave(room);
  }
}

export async function broadcast(ctx: Ctx, e: DomainEvent): Promise<void> {
  const io = getIO();
  if (!io) return; // tests and scripts without a socket server
  const emittedAt = new Date().toISOString();

  switch (e.type) {
    case 'seats.changed': {
      if (!e.changes.length) return;
      const changes: SeatChangeDto[] = e.changes; // already identity-free (toSeatChange)
      io.to(`event:${e.eventId}`).emit('seats:changed', {
        eventId: String(e.eventId),
        changes,
        clientMutationId: ctx.clientMutationId,
        emittedAt,
      });
      return;
    }
    case 'hold.changed': {
      // Always read it. "Expired" doesn't mean "no hold": the buyer may have started a new one since.
      const view = await holdViewForUser(e.userId, e.eventId, ctx.now());
      io.to(`user:${e.userId}`).emit('hold:changed', {
        eventId: String(e.eventId),
        hold: view.hold,
        reason: e.reason,
        serverTime: view.serverTime,
        clientMutationId: ctx.clientMutationId,
      });
      return;
    }
    case 'event.updated': {
      const ev = await Event.findOne({ _id: e.eventId })
        .select('-seatMap -description')
        .lean<EventLean>();
      if (!ev) return;
      io.to(`event:${e.eventId}`).emit('event:updated', {
        eventId: String(e.eventId),
        event: toPublicEventDto(ev, ctx.now()),
        emittedAt,
      });
      if (ev.status === 'draft') await removeViewersOfDraft(io, ev._id, ev.organizerId); // after telling them
      return;
    }
    case 'account.changed': {
      io.to(`user:${e.userId}`).emit('account:changed', {
        role: e.role,
        suspended: e.suspended,
        ...(e.application && { application: e.application }),
      });
      if (e.suspended) io.in(`user:${e.userId}`).disconnectSockets(true); // after telling them
      return;
    }
    case 'booking.confirmed': {
      // The buyer's other tabs: "you're going!" and stop their countdowns.
      io.to(`user:${e.userId}`).emit('booking:confirmed', {
        eventId: String(e.eventId),
        bookingId: String(e.bookingId),
      });
      return;
    }
    case 'sales.changed': {
      // publish() already bumped the counters (events/counters.ts), so read the new totals.
      const ev = await Event.findOne({ _id: e.eventId }).select('counters').lean<EventLean>();
      if (!ev) return;
      io.to(`staff:${e.eventId}`).emit('sales:updated', {
        eventId: String(e.eventId),
        seatsSold: ev.counters?.seatsSold ?? 0,
        revenue: ev.counters?.revenue ?? 0,
      });
      return;
    }
    default: {
      const unhandled: never = e; // a compile error here: you added a DomainEvent and forgot its broadcast
      return unhandled;
    }
  }
}
