import type { Types } from 'mongoose';
import type { Ctx } from './ctx';

declare global {
  namespace Express {
    interface Request {
      valid: unknown;
      userId: Types.ObjectId; // kept for Day 3 code
      sessionId: string;
      ctx: Ctx; // set by authenticate
      maybeCtx: Ctx | null; // set by optionalAuth (public routes, Day 6)
    }
  }
}

export {};
