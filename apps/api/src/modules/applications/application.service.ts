import type { ApplyInput } from '@seatbook/shared';
import { OrganizerApplication } from '../../db/models';
import { conflict } from '../../lib/errors';
import { subDays } from '../../lib/dates';
import type { Ctx } from '../../types/ctx';

export async function apply(ctx: Ctx, input: ApplyInput) {
  if (ctx.role !== 'attendee')
    throw conflict('ALREADY_ORGANIZER', 'You can already create events.'); // FR-APP-04

  const last = await OrganizerApplication.findOne({ userId: ctx.userId })
    .sort({ createdAt: -1 })
    .lean();
  if (last?.status === 'pending')
    throw conflict('APPLICATION_PENDING', 'Your application is being reviewed.');
  if (last?.status === 'rejected' && last.reviewedAt && last.reviewedAt > subDays(ctx.now(), 7)) {
    throw conflict('REAPPLY_TOO_SOON', 'You can apply again 7 days after a rejection.');
  }
  // Two submits at once both pass the check above; the partial unique index lets only one in
  // (E11000 one_pending_application → 409 APPLICATION_PENDING via the error handler).
  const app = await OrganizerApplication.create({
    userId: ctx.userId,
    ...input,
    website: input.website ?? null,
  });
  return app.toObject();
}

export const latestApplication = (ctx: Ctx) =>
  OrganizerApplication.findOne({ userId: ctx.userId }).sort({ createdAt: -1 }).lean();
