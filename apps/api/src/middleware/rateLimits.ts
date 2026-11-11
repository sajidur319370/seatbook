import type { Request } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
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

/** Per USER: 10 payment attempts a minute (FR-PAY-13). Must run after authenticate. */
export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `checkout:${String(req.ctx.userId)}`,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many payment attempts. Wait a minute.')),
});

/**
 * Check-in (FR-CHK-10): 120 scans a minute per organizer. A typed code that matches nothing costs
 * double, so guessing manual codes is twice as slow. The store is our own so the route can add
 * that second hit after it knows the result.
 */
export function createCheckinLimiter(opts: { limit?: number; skip?: () => boolean } = {}) {
  const store = new MemoryStore();
  const keyOf = (req: Request) => `checkin:${String(req.ctx.userId)}`;
  const middleware = rateLimit({
    windowMs: 60_000,
    limit: opts.limit ?? 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    keyGenerator: keyOf,
    skip: opts.skip ?? (() => env.NODE_ENV === 'test'),
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many scans. Wait a moment.')),
  });
  return { middleware, chargeAgain: (req: Request) => store.increment(keyOf(req)) };
}

export const checkinLimiter = createCheckinLimiter();
