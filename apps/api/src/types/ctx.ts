import type { Types } from 'mongoose';
import { ROLE_LEVEL, type Role } from '@seatbook/shared';

export interface Ctx {
  userId: Types.ObjectId;
  role: Role;
  roleLevel: number;
  name: string;
  email: string;
  now: () => Date; // injectable clock (tests on Day 12, seed on Day 20)
  clientMutationId?: string; // echo suppression (Day 15)
}

/** For tests, scripts and the seed: build a ctx without an HTTP request. */
export function makeCtx(p: {
  userId: Types.ObjectId;
  role: Role;
  name?: string;
  email?: string;
  now?: () => Date;
}): Ctx {
  return {
    userId: p.userId,
    role: p.role,
    roleLevel: ROLE_LEVEL[p.role],
    name: p.name ?? 'Test User',
    email: p.email ?? 'test@test.dev',
    now: p.now ?? (() => new Date()),
  };
}
