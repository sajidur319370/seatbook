import type { Types } from 'mongoose';
import { Event, type EventLean } from '../../db/models';
import { notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';

/** The fields ownedEventParam loads onto req.event. */
export type OwnedEventLean = Pick<
  EventLean,
  | '_id'
  | 'organizerId'
  | 'status'
  | 'revision'
  | 'timezone'
  | 'currency'
  | 'startsAt'
  | 'endsAt'
  | 'salesStartAt'
  | 'salesEndAt'
>;

/** Organizer routes: the event must belong to the actor. Admins get NO bypass here (FR-RBAC-04). */
export async function findOwnedEvent<T = EventLean>(
  ctx: Ctx,
  eventId: Types.ObjectId,
  select?: string,
) {
  const ev = await Event.findOne({ _id: eventId, organizerId: ctx.userId })
    .select(select ?? '')
    .lean<T>();
  if (!ev) throw notFound(); // identical for "doesn't exist" and "not yours" (NFR-SEC-02)
  return ev;
}

/** Admin routes only. Grep for callers: they must all live in modules/admin/. */
export async function findAnyEvent<T = EventLean>(eventId: Types.ObjectId, select?: string) {
  const ev = await Event.findOne({ _id: eventId })
    .select(select ?? '')
    .lean<T>();
  if (!ev) throw notFound();
  return ev;
}

/** Public routes: published only (drafts visible to their owner and admins for preview). */
export function publicEventFilter(ctx: Ctx | null) {
  if (ctx?.role === 'admin') return {};
  if (ctx) return { $or: [{ status: { $ne: 'draft' } }, { organizerId: ctx.userId }] };
  return { status: { $ne: 'draft' } };
}
