import { Router } from 'express';
import { changePasswordSchema, updateMeSchema } from '@seatbook/shared';
import { User } from '../../db/models';
import { notFound } from '../../lib/errors';
import { access } from '../../middleware/access';
import { validate, valid } from '../../middleware/validate';
import { toApplicationDto } from '../applications/application.dto';
import { latestApplication } from '../applications/application.service';
import { changePassword } from '../auth/auth.service';
import { toUserDto } from './user.dto';

export const meRouter = Router(); // mounted behind `authenticate`

meRouter.get('/', access('self'), async (req, res) => {
  const [user, application] = await Promise.all([
    User.findById(req.ctx.userId).lean(),
    latestApplication(req.ctx),
  ]);
  if (!user) throw notFound();
  res.json({
    user: toUserDto(user),
    application: application ? toApplicationDto(application) : null,
  });
});

const updateReq = { body: updateMeSchema };
meRouter.patch('/', access('self'), validate(updateReq), async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.ctx.userId,
    { $set: valid(req, updateReq).body },
    { new: true, runValidators: true },
  ).lean();
  if (!user) throw notFound();
  res.json({ user: toUserDto(user) });
});

const pwReq = { body: changePasswordSchema };
meRouter.patch('/password', access('self'), validate(pwReq), async (req, res) => {
  const { currentPassword, newPassword } = valid(req, pwReq).body;
  await changePassword(req.ctx.userId, req.sessionId, currentPassword, newPassword);
  res.json({ ok: true });
});
