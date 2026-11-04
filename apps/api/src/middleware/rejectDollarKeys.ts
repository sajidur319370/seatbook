import type { RequestHandler } from 'express';
import { badRequest } from '../lib/errors';

function hasBadKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBadKey);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, v]) => key.startsWith('$') || key.includes('.') || hasBadKey(v),
    );
  }
  return false;
}

// Express 5's default query parser doesn't build nested objects, so only the JSON body can carry them.
export const rejectDollarKeys: RequestHandler = (req, _res, next) => {
  if (hasBadKey(req.body)) {
    throw badRequest('INVALID_INPUT', 'Keys starting with "$" or containing "." are not allowed.');
  }
  next();
};
