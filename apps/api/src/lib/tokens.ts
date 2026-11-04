import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthenticated } from './errors';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export function signAccessToken({ userId, sessionId }: AccessClaims): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub || typeof payload.sid !== 'string') {
      throw unauthenticated();
    }
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError)
      throw unauthenticated('TOKEN_EXPIRED', 'Your session expired.');
    throw unauthenticated();
  }
}
