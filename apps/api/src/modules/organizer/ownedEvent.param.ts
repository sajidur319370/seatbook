import type { RequestParamHandler } from 'express';
import { OBJECT_ID } from '@seatbook/shared';
import { badRequest } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { findOwnedEvent, type OwnedEventLean } from '../events/scope';

/**
 * Runs BEFORE any handler of a route with :eventId (router.param).
 * Every organizer route is ownership-checked by construction (FR-RBAC-03).
 */
export const ownedEventParam: RequestParamHandler = (req, _res, next, raw: string) => {
  if (!OBJECT_ID.test(raw)) return next(badRequest('INVALID_ID', 'Invalid id.'));
  findOwnedEvent<OwnedEventLean>(
    req.ctx,
    oid(raw),
    '_id organizerId status revision timezone currency startsAt endsAt salesStartAt salesEndAt',
  ).then((ev) => {
    req.event = ev;
    next();
  }, next); // explicit promise handling: don't rely on the router catching param rejections
};
