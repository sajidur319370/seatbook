import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { unauthenticated } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthenticated();
  const { userId, sessionId } = verifyAccessToken(header.slice('Bearer '.length));
  req.userId = new Types.ObjectId(userId);
  req.sessionId = sessionId;
  next();
};
