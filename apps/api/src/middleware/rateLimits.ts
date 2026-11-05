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

const tooManyClicks = () => new AppError(429, 'RATE_LIMITED', 'Slow down: too many seat clicks.');

/** Per USER: must run after authenticate (FR-HOLD-11). */
export const holdUserLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `hold:${String(req.ctx.userId)}`,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(tooManyClicks()),
});

export const holdIpLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(tooManyClicks()),
});
