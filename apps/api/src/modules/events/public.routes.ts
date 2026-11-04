import { Router } from 'express';
import { z } from 'zod';
import { EVENT_CATEGORIES } from '@seatbook/shared';
import { Event, type EventLean } from '../../db/models';
import { decodeStartsCursor, encodeStartsCursor } from '../../lib/cursor';
import { notFound } from '../../lib/errors';
import { escapeRegex } from '../../lib/regex';
import { optionalAuth } from '../../middleware/authenticate';
import { validate, valid } from '../../middleware/validate';
import { publicEventFilter } from './scope';
import { toPublicEventDto } from './event.dto';
import { organizerName } from '../organizer/event.service';

export const publicEventsRouter = Router();

const listReq = {
  query: z.object({
    q: z.string().trim().max(80).optional(),
    category: z.enum(EVENT_CATEGORIES).optional(),
    city: z.string().trim().max(60).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().optional(),
  }),
};

publicEventsRouter.get('/', validate(listReq), async (req, res) => {
  const q = valid(req, listReq).query;
  const now = new Date();
  const filter: Record<string, unknown> = { status: 'published', endsAt: { $gt: now } }; // FR-EVT-07/11
  if (q.category) filter.category = q.category;
  if (q.city) filter['venue.city'] = { $regex: `^${escapeRegex(q.city)}$`, $options: 'i' };
  const starts: Record<string, Date> = {};
  if (q.from) starts.$gte = new Date(q.from);
  if (q.to) starts.$lt = new Date(q.to);
  if (Object.keys(starts).length) filter.startsAt = starts;

  // Search and the cursor each need an $or, so they go under $and: a second filter.$or would overwrite the first.
  const and: Record<string, unknown>[] = [];
  if (q.q) {
    const term = { $regex: escapeRegex(q.q), $options: 'i' };
    and.push({ $or: [{ title: term }, { 'venue.name': term }, { 'venue.city': term }] }); // FR-EVT-07
  }
  if (q.cursor) {
    const { t, id } = decodeStartsCursor(q.cursor);
    and.push({ $or: [{ startsAt: { $gt: t } }, { startsAt: t, _id: { $gt: id } }] });
  }
  if (and.length) filter.$and = and;

  const rows = await Event.find(filter)
    .sort({ startsAt: 1, _id: 1 }) // index { status, startsAt } (queries.md §6.1)
    .limit(25)
    .select('-seatMap -description')
    .lean<EventLean[]>();
  const page = rows.slice(0, 24);
  res.json({
    items: page.map((e) => toPublicEventDto(e, now)),
    nextCursor: rows.length > 24 ? encodeStartsCursor(page.at(-1)!) : null,
  });
});

publicEventsRouter.get('/:slug', optionalAuth, async (req, res) => {
  const ev = await Event.findOne({
    slug: String(req.params.slug).toLowerCase(),
    ...publicEventFilter(req.maybeCtx),
  })
    .select('-seatMap')
    .lean<EventLean>();
  if (!ev) throw notFound(); // drafts → 404 for everyone but the owner/admin (FR-EVT-08)
  res.json({
    event: toPublicEventDto(ev, new Date(), {
      description: ev.description,
      organizerName: await organizerName(ev.organizerId),
    }),
  });
  // Day 7 adds tiers[].remaining
});
