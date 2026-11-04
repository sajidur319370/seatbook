import type { Response } from 'express';
import { isProd } from '../../config/env';

export const REFRESH_COOKIE = 'sb_refresh';

const options = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth', // the browser sends it ONLY to auth endpoints
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...options, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, options);
}
