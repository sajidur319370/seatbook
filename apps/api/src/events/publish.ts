import { logger } from '../lib/logger';
import { broadcast } from '../realtime/broadcast';
import type { Ctx } from '../types/ctx';
import { applyCounters } from './counters';
import type { DomainEvent } from './types';

/** Called AFTER writes commit, so a message never announces something that could still roll back. */
export async function publish(ctx: Ctx, events: DomainEvent[]): Promise<void> {
  for (const e of events) {
    logger.debug({ type: e.type, actor: String(ctx.userId) }, 'domain event');
    try {
      // Counters first, so the broadcast reads the new numbers. Here and not in broadcast(),
      // which returns early when there's no socket server (tests, scripts, the seed).
      await applyCounters(e);
      await broadcast(ctx, e);
    } catch (err) {
      logger.error({ err, type: e.type }, 'broadcast failed'); // the write succeeded: never fail the request
    }
  }
}
