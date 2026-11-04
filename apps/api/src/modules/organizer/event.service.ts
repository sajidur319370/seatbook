import type { Types } from 'mongoose';
import {
  EDITABLE_AFTER_PUBLISH,
  LIMITS,
  scheduleIssues,
  type CreateEventInput,
  type UpdateEventInput,
} from '@seatbook/shared';
import { Event, User, type EventLean } from '../../db/models';
import { decodeStartsCursor, encodeStartsCursor } from '../../lib/cursor';
import { AppError, badRequest, conflict } from '../../lib/errors';
import { isDuplicateKey } from '../../lib/mongoErrors';
import { slugWithSuffix } from '../../lib/slug';
import { findOwnedEvent } from '../events/scope';
import type { Ctx } from '../../types/ctx';

export async function createEvent(ctx: Ctx, input: CreateEventInput) {
  const count = await Event.countDocuments({ organizerId: ctx.userId });
  if (count >= LIMITS.eventsPerOrganizer)
    throw conflict('EVENT_LIMIT', `You can have at most ${LIMITS.eventsPerOrganizer} events.`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ev = await Event.create({
        ...input,
        organizerId: ctx.userId,
        slug: slugWithSuffix(input.title),
      });
      return ev.toObject() as EventLean;
    } catch (err) {
      if (!isDuplicateKey(err, 'uniq_event_slug')) throw err; // 1 in a million: pick another suffix
    }
  }
  throw new AppError(500, 'INTERNAL_ERROR');
}

export async function updateEvent(ctx: Ctx, eventId: Types.ObjectId, input: UpdateEventInput) {
  const current = await findOwnedEvent(ctx, eventId);
  const { expectedRevision, ...changes } = input;

  // Mass-assignment protection (NFR-SEC-14): the schema has no organizerId/status/counters fields at all,
  // and after publish only a short list of fields may change (FR-EVT-02).
  if (current.status !== 'draft') {
    const forbiddenFields = Object.keys(changes).filter(
      (k) => !(EDITABLE_AFTER_PUBLISH as readonly string[]).includes(k),
    );
    if (forbiddenFields.length)
      throw conflict('EVENT_NOT_DRAFT', 'This field is locked after publishing.', {
        fields: forbiddenFields,
      });
  }

  const merged = { ...current, ...changes };
  const issues = scheduleIssues(merged);
  if (issues.length) throw badRequest('INVALID_SCHEDULE', issues[0]!.message, issues);

  const updated = await Event.findOneAndUpdate(
    {
      _id: eventId,
      organizerId: ctx.userId,
      revision: expectedRevision,
      status: { $ne: 'cancelled' },
    },
    { $set: changes, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  ).lean<EventLean>();
  if (!updated) {
    const ev = await findOwnedEvent(ctx, eventId, 'revision status');
    if (ev.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'This event was cancelled.');
    throw conflict('STALE_DRAFT', 'This event was changed in another tab.', {
      revision: ev.revision,
    });
  }
  return updated;
}

export async function deleteDraft(ctx: Ctx, eventId: Types.ObjectId) {
  const res = await Event.deleteOne({ _id: eventId, organizerId: ctx.userId, status: 'draft' });
  if (res.deletedCount === 0) {
    await findOwnedEvent(ctx, eventId, '_id'); // 404 if not mine
    throw conflict('EVENT_NOT_DRAFT', 'Only drafts can be deleted.');
  }
}

/** Newest start first, 50 per page. Callers put the owner (or nothing, for admins) in `filter`. */
export async function listEventsNewestFirst(filter: Record<string, unknown>, cursor?: string) {
  const query = { ...filter };
  if (cursor) {
    const { t, id } = decodeStartsCursor(cursor);
    query.$or = [{ startsAt: { $lt: t } }, { startsAt: t, _id: { $lt: id } }];
  }
  const rows = await Event.find(query)
    .sort({ startsAt: -1, _id: -1 }) // index { organizerId, startsAt }
    .limit(51)
    .select('-seatMap -description')
    .lean<EventLean[]>();
  const page = rows.slice(0, 50);
  return { items: page, nextCursor: rows.length > 50 ? encodeStartsCursor(page.at(-1)!) : null };
}

export function listMyEvents(ctx: Ctx, q: { status?: string; cursor?: string }) {
  return listEventsNewestFirst(
    { organizerId: ctx.userId, ...(q.status && { status: q.status }) },
    q.cursor,
  );
}

export async function organizerName(organizerId: Types.ObjectId) {
  const u = await User.findById(organizerId).select('organizationName name').lean();
  return u?.organizationName ?? u?.name ?? '';
}
