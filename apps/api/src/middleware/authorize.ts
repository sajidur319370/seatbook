import type { RequestHandler } from 'express';
import { can, type Permission } from '@seatbook/shared';
import { forbidden } from '../lib/errors';
import { logger } from '../lib/logger';

export const authorize = (permission: Permission): RequestHandler => {
  const mw: RequestHandler & { permission?: Permission } = (req, _res, next) => {
    if (!can(req.ctx.role, permission)) {
      if (req.method !== 'GET') {
        logger.warn(
          {
            userId: String(req.ctx.userId),
            role: req.ctx.role,
            permission,
            route: req.originalUrl,
          },
          'permission denied',
        ); // FR-RBAC-07
      }
      throw forbidden('FORBIDDEN', "You don't have permission to do that.", { permission });
    }
    next();
  };
  mw.permission = permission; // Day 20's route-guard test looks for this marker
  return mw;
};
