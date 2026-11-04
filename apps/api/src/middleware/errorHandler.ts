import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../lib/errors';

/**
 * E11000 duplicate-key errors carry the index name → API error (schema.md §14).
 * Only the indexes that mean "the client asked for something that already exists" are here.
 * The race-related ones (one_active_hold, uniq_booking_hold, uniq_idempotency…) are caught
 * and handled INSIDE their services; if one ever reaches this handler, it's a bug → 500.
 */
const DUPLICATE_KEY: Record<string, { status: number; code: string }> = {
  uniq_email: { status: 409, code: 'EMAIL_TAKEN' },
  one_pending_application: { status: 409, code: 'APPLICATION_PENDING' },
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    return badRequest(
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      err.issues.map((i) => ({ field: i.path.join('.'), issue: i.code, message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError) return badRequest('INVALID_ID', 'Invalid id.');
  if (err instanceof mongoose.Error.ValidationError)
    return badRequest('VALIDATION_ERROR', err.message);

  const e = err as { code?: number; message?: string; type?: string };
  if (e.code === 11000) {
    const index = /index: (\S+)/.exec(e.message ?? '')?.[1];
    const mapped = index ? DUPLICATE_KEY[index] : undefined;
    if (mapped) return new AppError(mapped.status, mapped.code);
  }
  if (e.type === 'entity.parse.failed')
    return badRequest('INVALID_JSON', 'Request body is not valid JSON.');
  if (e.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);
  if (appErr.status >= 500) req.log.error({ err }, 'unhandled error'); // real error only in logs
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      details: appErr.details,
      requestId: req.id,
    },
  });
};

export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(notFound('Route not found.'));
