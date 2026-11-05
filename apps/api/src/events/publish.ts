import { logger } from '../lib/logger';
import type { Ctx } from '../types/ctx';
import type { DomainEvent } from './types';

/** Called AFTER writes commit. Day 14 adds broadcast(), Day 16 counters and mail. */
export async function publish(ctx: Ctx, events: DomainEvent[]): Promise<void> {
  for (const e of events) {
    logger.debug({ type: e.type, actor: String(ctx.userId) }, 'domain event');
  }
}
