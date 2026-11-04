import { Router } from 'express';
import { applySchema } from '@seatbook/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { apply, latestApplication } from './application.service';
import { toApplicationDto } from './application.dto';

export const applicationRouter = Router(); // mounted behind authenticate

const applyReq = { body: applySchema };
applicationRouter.post('/', authorize('organizer:apply'), validate(applyReq), async (req, res) => {
  res
    .status(201)
    .json({ application: toApplicationDto(await apply(req.ctx, valid(req, applyReq).body)) });
});

applicationRouter.get('/mine', authorize('organizer:apply'), async (req, res) => {
  const a = await latestApplication(req.ctx);
  res.json({ application: a ? toApplicationDto(a) : null });
});
