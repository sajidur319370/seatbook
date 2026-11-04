import { Router } from 'express';
import { z } from 'zod';
import { objectIdSchema, rejectSchema, ROLES } from '@seatbook/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
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
