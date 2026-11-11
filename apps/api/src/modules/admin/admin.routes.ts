import { Router } from 'express';
import { z } from 'zod';
import { EVENT_STATUSES, objectIdSchema, rejectSchema, ROLES } from '@seatbook/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import {
  DASHBOARD_EVENT_FIELDS,
  eventDashboard,
  type DashboardEvent,
} from '../dashboard/dashboard.service';
import { adminOverview } from '../dashboard/overview.service';
import { toOrganizerEventDto } from '../events/event.dto';
import { findAnyEvent } from '../events/scope';
import { listEventsNewestFirst } from '../organizer/event.service';
import * as admin from './admin.service';

export const adminRouter = Router(); // mounted behind authenticate

const idParams = z.object({ id: objectIdSchema });

const listAppsReq = {
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
    cursor: z.string().optional(),
  }),
};
adminRouter.get(
  '/organizer-applications',
  authorize('admin:applications'),
  validate(listAppsReq),
  async (req, res) => {
    const { status, cursor } = valid(req, listAppsReq).query;
    res.json(await admin.listApplications(status, cursor));
  },
);

const approveReq = { params: idParams };
adminRouter.post(
  '/organizer-applications/:id/approve',
  authorize('admin:applications'),
  validate(approveReq),
  async (req, res) => {
    const { params } = valid(req, approveReq);
    res.json({ application: await admin.approveApplication(req.ctx, oid(params.id)) });
  },
);

const rejectReq = { params: idParams, body: rejectSchema };
adminRouter.post(
  '/organizer-applications/:id/reject',
  authorize('admin:applications'),
  validate(rejectReq),
  async (req, res) => {
    const { params, body } = valid(req, rejectReq);
    res.json({ application: await admin.rejectApplication(req.ctx, oid(params.id), body.reason) });
  },
);

const listUsersReq = {
  query: z.object({
    q: z.string().max(100).optional(),
    role: z.enum(ROLES).optional(),
    suspended: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    cursor: objectIdSchema.optional(),
  }),
};
adminRouter.get('/users', authorize('admin:users'), validate(listUsersReq), async (req, res) => {
  res.json(await admin.listUsers(valid(req, listUsersReq).query));
});

const listEventsReq = {
  query: z.object({
    status: z.enum(EVENT_STATUSES).optional(),
    organizerId: objectIdSchema.optional(),
    cursor: z.string().optional(),
  }),
};
adminRouter.get('/events', authorize('admin:events'), validate(listEventsReq), async (req, res) => {
  const q = valid(req, listEventsReq).query;
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.organizerId) filter.organizerId = oid(q.organizerId);
  const { items, nextCursor } = await listEventsNewestFirst(filter, q.cursor);
  const names = await admin.organizerNames(items.map((e) => e.organizerId));
  res.json({
    items: items.map((e) => ({
      ...toOrganizerEventDto(e),
      organizerName: names.get(String(e.organizerId)) ?? '',
    })),
    nextCursor,
  });
});

const patchUserReq = {
  params: idParams,
  body: z
    .object({
      role: z.enum(['attendee', 'organizer']).optional(), // never 'admin' (FR-ADM-04)
      suspended: z.boolean().optional(),
      reason: z.string().trim().min(5).max(500).optional(),
    })
    .refine((b) => b.role !== undefined || b.suspended !== undefined, 'Nothing to change'),
};
adminRouter.patch(
  '/users/:id',
  authorize('admin:users'),
  validate(patchUserReq),
  async (req, res) => {
    const { params, body } = valid(req, patchUserReq);
    res.json({ user: await admin.updateUser(req.ctx, oid(params.id), body) });
  },
);

adminRouter.get('/overview', authorize('admin:overview'), async (req, res) => {
  res.json(await adminOverview(req.ctx.now()));
});

// Any event, read-only: findAnyEvent may only be called from modules/admin/ (schema.md §3).
// 'admin:events', NOT 'dashboard:view': organizers have that one, and this route skips the
// ownership check, so it would show them every other organizer's sales.
const dashReq = { params: z.object({ eventId: objectIdSchema }) };
adminRouter.get(
  '/events/:eventId/dashboard',
  authorize('admin:events'),
  validate(dashReq),
  async (req, res) => {
    const ev = await findAnyEvent<DashboardEvent>(
      oid(valid(req, dashReq).params.eventId),
      DASHBOARD_EVENT_FIELDS,
    );
    res.json(await eventDashboard(ev, req.ctx.now()));
  },
);
