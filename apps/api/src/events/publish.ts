import { logger } from '../lib/logger';
import { broadcast } from '../realtime/broadcast';
import type { Ctx } from '../types/ctx';
import type { DomainEvent } from './types';

/** Called AFTER writes commit, so a message never announces something that could still roll back. Day 16 adds counters and mail. */
export async function publish(ctx: Ctx, events: DomainEvent[]): Promise<void> {
  for (const e of events) {
    logger.debug({ type: e.type, actor: String(ctx.userId) }, 'domain event');
    try {
      await broadcast(ctx, e);
    } catch (err) {
      logger.error({ err, type: e.type }, 'broadcast failed'); // the write succeeded: never fail the request
    }
  }
}
