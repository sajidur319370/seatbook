import { Router } from 'express';
import { z } from 'zod';
import { createEventSchema, EVENT_STATUSES, updateEventSchema } from '@seatbook/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { ownedEventParam } from './ownedEvent.param';
import * as svc from './event.service';
import { findOwnedEvent } from '../events/scope';
import { toOrganizerEventDto } from '../events/event.dto';

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
// Day 7: seat-map, publish, unpublish · Day 18: check-in · Day 19: dashboard, attendees
