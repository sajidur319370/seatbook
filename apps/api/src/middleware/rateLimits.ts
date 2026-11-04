import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20, // per IP per window, on login/register/forgot
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.')),
});
