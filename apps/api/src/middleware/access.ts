import type { RequestHandler } from 'express';

export type Access = 'public' | 'self';

/**
 * A no-op that DOCUMENTS a route needing no permission key: 'public' (anyone, logged in or not)
 * or 'self' (the caller's own account or session). The route-guard test reads `.access`, so every
 * route declares either this or authorize(permission), and a forgotten guard fails CI.
 */
export function access(kind: Access): RequestHandler {
  const mw: RequestHandler & { access?: Access } = (_req, _res, next) => next();
  mw.access = kind;
  return mw;
}
