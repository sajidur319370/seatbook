import { Router } from 'express';
import { z } from 'zod';
import { objectIdSchema, PAYMENT_TOKENS } from '@seatbook/shared';
import { badRequest } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { checkoutLimiter } from '../../middleware/rateLimits';
import { validate, valid } from '../../middleware/validate';
import { checkout } from './checkout.service';

/** Mounted on the same path as the hold router: /events/:eventId/hold (see routes.ts). */
export const checkoutRouter = Router({ mergeParams: true });

const checkoutReq = {
  params: z.object({ eventId: objectIdSchema }),
  body: z.object({ paymentToken: z.enum(PAYMENT_TOKENS) }),
};
const idempotencyKey = z.uuid({ version: 'v4' });

checkoutRouter.post(
  '/checkout',
  authorize('booking:create'),
  checkoutLimiter,
  validate(checkoutReq),
  async (req, res) => {
    // The client makes one key when the checkout page opens and sends it with every retry (FR-PAY-02).
    const key = idempotencyKey.safeParse(req.get('idempotency-key'));
    if (!key.success)
      throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Send an Idempotency-Key header (UUID v4).');
    const { params, body } = valid(req, checkoutReq);
    const { status, booking } = await checkout(req.ctx, oid(params.eventId), body, key.data);
    res.status(status).json({ booking });
  },
);
