import { Router } from 'express';
import { z } from 'zod';
import {
  checkInSchema,
  createEventSchema,
  EVENT_STATUSES,
  objectIdSchema,
  scanFeedQuerySchema,
  seatMapInputSchema,
  updateEventSchema,
} from '@seatbook/shared';
import { badRequest } from '../../lib/errors';
import { authorize } from '../../middleware/authorize';
import { checkinLimiter } from '../../middleware/rateLimits';
import { validate, valid } from '../../middleware/validate';
import { ownedEventParam } from './ownedEvent.param';
import * as svc from './event.service';
import { publishEvent, unpublishEvent } from './publish.service';
import { saveSeatMap } from './seatmap.service';
import { findOwnedEvent } from '../events/scope';
import { toOrganizerEventDto } from '../events/event.dto';
import { checkIn, scanFeed } from '../checkin/checkin.service';
import { attendeeList } from '../dashboard/attendees.service';
import {
  DASHBOARD_EVENT_FIELDS,
  eventDashboard,
  type DashboardEvent,
} from '../dashboard/dashboard.service';
import { organizerOverview } from '../dashboard/overview.service';

export const organizerRouter = Router(); // mounted behind authenticate

organizerRouter.use(authorize('event:manage')); // attendees stop here with 403, before any lookup
organizerRouter.param('eventId', ownedEventParam); // everything below with :eventId is owned (or 404)

const createReq = { body: createEventSchema };
organizerRouter.post(
  '/events',
  authorize('event:create'),
  validate(createReq),
  async (req, res) => {
    res.status(201).json({
      event: toOrganizerEventDto(await svc.createEvent(req.ctx, valid(req, createReq).body)),
    });
  },
);

const listReq = {
  query: z.object({ status: z.enum(EVENT_STATUSES).optional(), cursor: z.string().optional() }),
};
organizerRouter.get('/events', authorize('event:manage'), validate(listReq), async (req, res) => {
  const { items, nextCursor } = await svc.listMyEvents(req.ctx, valid(req, listReq).query);
  res.json({ items: items.map((e) => toOrganizerEventDto(e)), nextCursor });
});

organizerRouter.get('/events/:eventId', authorize('event:manage'), async (req, res) => {
  res.json({ event: toOrganizerEventDto(await findOwnedEvent(req.ctx, req.event!._id)) });
});

const updateReq = { body: updateEventSchema };
organizerRouter.patch(
  '/events/:eventId',
  authorize('event:manage'),
  validate(updateReq),
  async (req, res) => {
    res.json({
      event: toOrganizerEventDto(
        await svc.updateEvent(req.ctx, req.event!._id, valid(req, updateReq).body),
      ),
    });
  },
);

organizerRouter.delete('/events/:eventId', authorize('event:manage'), async (req, res) => {
  await svc.deleteDraft(req.ctx, req.event!._id);
  res.status(204).end();
});

organizerRouter.put('/events/:eventId/seat-map', authorize('event:manage'), async (req, res) => {
  const parsed = seatMapInputSchema.safeParse(req.body);
  if (!parsed.success) {
    // One clear code for every layout problem, with a path the builder can highlight.
    throw badRequest(
      'SEAT_MAP_INVALID',
      'The seat map has problems.',
      parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
        ...((i as { params?: object }).params ?? {}),
      })),
    );
  }
  res.json({ event: toOrganizerEventDto(await saveSeatMap(req.ctx, req.event!._id, parsed.data)) });
});

organizerRouter.post('/events/:eventId/publish', authorize('event:manage'), async (req, res) => {
  res.json({ event: toOrganizerEventDto(await publishEvent(req.ctx, req.event!._id)) });
});

organizerRouter.post('/events/:eventId/unpublish', authorize('event:manage'), async (req, res) => {
  res.json({ event: toOrganizerEventDto(await unpublishEvent(req.ctx, req.event!._id)) });
});

const checkInReq = { body: checkInSchema };
organizerRouter.post(
  '/events/:eventId/check-in',
  authorize('checkin:perform'),
  checkinLimiter.middleware,
  validate(checkInReq),
  async (req, res) => {
    const input = valid(req, checkInReq).body;
    const r = await checkIn(req.ctx, req.event!, input);
    // FR-CHK-10: a typed code that matches nothing costs a second hit (slows down guessing).
    if (r.result === 'not_found' && input.method === 'manual')
      await checkinLimiter.chargeAgain(req);
    res.json(r); // always 200 for business results (FR-CHK-05)
  },
);

const scansReq = { query: scanFeedQuerySchema };
organizerRouter.get(
  '/events/:eventId/scans',
  authorize('checkin:perform'),
  validate(scansReq),
  async (req, res) => {
    res.json(await scanFeed(req.event!._id, valid(req, scansReq).query));
  },
);

// FR-DASH-09: totals across the caller's own events.
organizerRouter.get('/overview', authorize('dashboard:view'), async (req, res) => {
  res.json(await organizerOverview(req.ctx));
});

organizerRouter.get('/events/:eventId/dashboard', authorize('dashboard:view'), async (req, res) => {
  const ev = await findOwnedEvent<DashboardEvent>(req.ctx, req.event!._id, DASHBOARD_EVENT_FIELDS);
  res.json(await eventDashboard(ev, req.ctx.now()));
});

const attendeesReq = {
  query: z.object({
    q: z.string().trim().max(100).optional(),
    cursor: objectIdSchema.optional(),
  }),
};
organizerRouter.get(
  '/events/:eventId/attendees',
  authorize('attendees:view'),
  validate(attendeesReq),
  async (req, res) => {
    res.json(await attendeeList(req.event!._id, valid(req, attendeesReq).query));
  },
);
