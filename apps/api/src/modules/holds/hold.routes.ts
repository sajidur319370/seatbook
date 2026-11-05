import { Router } from 'express';
import { z } from 'zod';
import { addSeatSchema, objectIdSchema } from '@seatbook/shared';
import { Hold } from '../../db/models';
import { oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { holdIpLimiter, holdUserLimiter } from '../../middleware/rateLimits';
import { validate, valid } from '../../middleware/validate';
import * as holds from './hold.service';

export const holdRouter = Router({ mergeParams: true }); // mounted at /events/:eventId/hold
const eventParams = z.object({ eventId: objectIdSchema });

const getReq = { params: eventParams };
holdRouter.get('/', authorize('seat:hold'), validate(getReq), async (req, res) => {
  const eventId = oid(valid(req, getReq).params.eventId);
  const hold = await Hold.findOne({ eventId, userId: req.ctx.userId, status: 'active' })
    .select('_id')
    .lean();
  res.json(await holds.holdView(req.ctx, hold?._id ?? null));
});

const addReq = { params: eventParams, body: addSeatSchema };
holdRouter.post(
  '/seats',
  authorize('seat:hold'),
  holdIpLimiter,
  holdUserLimiter,
  validate(addReq),
  async (req, res) => {
    const { params, body } = valid(req, addReq);
    res.json(await holds.addSeat(req.ctx, oid(params.eventId), oid(body.seatId)));
  },
);

const removeReq = { params: eventParams.extend({ seatId: objectIdSchema }) };
holdRouter.delete(
  '/seats/:seatId',
  authorize('seat:hold'),
  holdUserLimiter,
  validate(removeReq),
  async (req, res) => {
    const { params } = valid(req, removeReq);
    res.json(await holds.removeSeat(req.ctx, oid(params.eventId), oid(params.seatId)));
  },
);

holdRouter.delete('/', authorize('seat:hold'), validate(getReq), async (req, res) => {
  const eventId = oid(valid(req, getReq).params.eventId);
  res.json(await holds.releaseMyHold(req.ctx, eventId));
});
