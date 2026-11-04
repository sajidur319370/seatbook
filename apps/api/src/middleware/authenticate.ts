import type { Request, RequestHandler } from 'express';
import { ROLE_LEVEL } from '@seatbook/shared';
import { User } from '../db/models';
import { forbidden, unauthenticated } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import type { Ctx } from '../types/ctx';

async function loadCtx(req: Request, token: string): Promise<Ctx> {
  const { userId, sessionId } = verifyAccessToken(token);
  // FR-AUTH-15: role and suspension from the DB on EVERY request.
  const user = await User.findById(userId).select('role suspendedAt name email').lean();
  if (!user) throw unauthenticated();
  if (user.suspendedAt) throw forbidden('ACCOUNT_SUSPENDED', 'This account is suspended.');

  req.userId = user._id;
  req.sessionId = sessionId;
  return {
    userId: user._id,
    role: user.role,
    roleLevel: ROLE_LEVEL[user.role],
    name: user.name,
    email: user.email,
    now: () => new Date(),
    clientMutationId: req.get('x-client-mutation-id')?.slice(0, 64),
  };
}

const bearer = (req: Request) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = bearer(req);
  if (!token) throw unauthenticated();
  req.ctx = await loadCtx(req, token);
  next();
};

/** Public routes that show more to some users (e.g. a draft to its owner). Never throws for "no token". */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = bearer(req);
  req.maybeCtx = token ? await loadCtx(req, token) : null;
  next();
};
