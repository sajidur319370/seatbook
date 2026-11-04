import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      valid: unknown;
      userId: Types.ObjectId; // set by authenticate
      sessionId: string; // set by authenticate
    }
  }
}

export {};
