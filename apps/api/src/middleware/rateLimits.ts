import type { Request, RequestHandler } from 'express';
import rateLimit, { MemoryStore, type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

/**
 * NFR-SEC-07, one limiter per rule. Every one answers 429 RATE_LIMITED with Retry-After
 * (standardHeaders 'draft-8'). Off in tests, and with RATE_LIMITS=off for the local load test,
 * which env.ts refuses in production.
 */
const limitsOff = () => env.NODE_ENV === 'test' || env.RATE_LIMITS === 'off';

function limiter(
  o: Pick<Options, 'windowMs' | 'limit'> & {
    message: string;
    keyGenerator?: Options['keyGenerator'];
    store?: Options['store'];
    skip?: () => boolean;
  },
): RequestHandler {
  return rateLimit({
    windowMs: o.windowMs,
    limit: o.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(o.keyGenerator && { keyGenerator: o.keyGenerator }),
    ...(o.store && { store: o.store }),
    skip: o.skip ?? limitsOff,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', o.message)),
  });
}

const userKey = (prefix: string) => (req: Request) => `${prefix}:${String(req.ctx.userId)}`;

/** Login: 20 per 15 min per IP. */
export const authLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: 20,
  message: 'Too many attempts. Try again later.',
});

/** Sign-up: 5 per hour per IP. */
export const signupLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 5,
  message: 'Too many new accounts from here. Try again later.',
});

/**
 * Forgot password: 3 per hour per EMAIL, so nobody can flood one person's inbox. Runs before
 * validation, so the raw body is normalised here the same way the schema does.
 */
export const forgotLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 3,
  keyGenerator: (req) =>
    `forgot:${String((req.body as { email?: unknown } | undefined)?.email ?? '')
      .trim()
      .toLowerCase()}`,
  message: 'Too many reset emails for this address. Try again in an hour.',
});

/** Reset password: same IP budget as login (the token is 256 random bits; this is hygiene). */
export const resetLimiter = authLimiter;

/** Every authenticated API call: 300 per minute per USER. Mounted right after authenticate. */
export const apiUserLimiter = limiter({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: userKey('api'),
  message: 'Too many requests. Slow down a little.',
});

const tooManyClicks = 'Slow down: too many seat clicks.';

/** Holds, per USER: must run after authenticate (FR-HOLD-11). */
export const holdUserLimiter = limiter({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: userKey('hold'),
  message: tooManyClicks,
});

/** Holds, per IP: one person can't hoard with many accounts from one place. */
export const holdIpLimiter = limiter({ windowMs: 60_000, limit: 60, message: tooManyClicks });

/** Per USER: 10 payment attempts a minute (FR-PAY-13). Must run after authenticate. */
export const checkoutLimiter = limiter({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: userKey('checkout'),
  message: 'Too many payment attempts. Wait a minute.',
});

/**
 * Check-in (FR-CHK-10): 120 scans a minute per organizer. A typed code that matches nothing costs
 * double, so guessing manual codes is twice as slow. The store is our own so the route can add
 * that second hit after it knows the result.
 */
export function createCheckinLimiter(opts: { limit?: number; skip?: () => boolean } = {}) {
  const store = new MemoryStore();
  const keyOf = userKey('checkin');
  const middleware = limiter({
    windowMs: 60_000,
    limit: opts.limit ?? 120,
    store,
    keyGenerator: keyOf,
    skip: opts.skip,
    message: 'Too many scans. Wait a moment.',
  });
  return { middleware, chargeAgain: (req: Request) => store.increment(keyOf(req)) };
}

export const checkinLimiter = createCheckinLimiter();
