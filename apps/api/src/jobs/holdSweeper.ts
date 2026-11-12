import os from 'node:os';
import type { Types } from 'mongoose';
import { SWEEPER } from '@seatbook/shared';
import { env } from '../config/env';
import { CLEAR_HOLD, Hold, JobLock, Seat } from '../db/models';
import { publish } from '../events/publish';
import { logger } from '../lib/logger';
import { isDuplicateKey } from '../lib/mongoErrors';
import { pMap } from '../lib/pMap';
import {
  SEAT_CHANGE_FIELDS,
  toSeatChange,
  type SeatChangeRow,
} from '../modules/holds/hold.service';
import { systemCtx } from '../types/ctx';

export const INSTANCE_ID = `${os.hostname()}-${process.pid}`;
export const LOCK = 'hold-sweeper';

/** Lease lock: free if the lease ran out, or already ours (renew). */
export async function acquireLock(now: Date, instanceId = INSTANCE_ID): Promise<boolean> {
  try {
    const lock = await JobLock.findOneAndUpdate(
      { _id: LOCK, $or: [{ lockedUntil: { $lt: now } }, { lockedBy: instanceId }] },
      { $set: { lockedBy: instanceId, lockedUntil: new Date(now.getTime() + SWEEPER.lockTtlMs) } },
      { upsert: true, new: true },
    ).lean();
    return lock?.lockedBy === instanceId;
  } catch (err) {
    if (isDuplicateKey(err)) return false; // the upsert collided with another instance's lock
    throw err;
  }
}

/** Releases ONE expired seat, only if nobody touched it since we read it (AC-EXP-03). */
export function releaseExpiredSeat(s: { _id: Types.ObjectId; version: number }, now: Date) {
  return Seat.findOneAndUpdate(
    { _id: s._id, status: 'held', version: s.version, holdExpiresAt: { $lte: now } },
    { $set: { status: 'available', ...CLEAR_HOLD }, $inc: { version: 1 } },
    { new: true, projection: SEAT_CHANGE_FIELDS },
  ).lean<SeatChangeRow>();
}

/** queries.md §9.2 */
export async function sweepOnce(now = new Date(), instanceId = INSTANCE_ID) {
  if (!(await acquireLock(now, instanceId))) return { skipped: true as const };
  const ctx = systemCtx(now);

  // 1. Seats (partial index sweep_expired_holds)
  const expired = await Seat.find({ status: 'held', holdExpiresAt: { $lte: now } })
    .sort({ holdExpiresAt: 1 })
    .limit(SWEEPER.batchSize)
    .select('_id eventId version holdExpiresAt')
    .lean();
  const results = await pMap(expired, (s) => releaseExpiredSeat(s, now), SWEEPER.concurrency);
  const released = results.filter((s) => s !== null);

  const byEvent = new Map<string, SeatChangeRow[]>();
  for (const s of released) {
    const key = String(s.eventId);
    byEvent.set(key, [...(byEvent.get(key) ?? []), s]);
  }
  await publish(
    ctx,
    [...byEvent.values()].map((seats) => ({
      type: 'seats.changed' as const,
      eventId: seats[0]!.eventId,
      changes: seats.map(toSeatChange),
    })),
  );

  // 2. Holds
  const holds = await Hold.find({ status: 'active', expiresAt: { $lte: now } })
    .limit(SWEEPER.batchSize)
    .select('_id userId eventId')
    .lean();
  const expiredHolds = [];
  for (const h of holds) {
    const r = await Hold.updateOne(
      { _id: h._id, status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
    );
    if (r.modifiedCount) expiredHolds.push(h);
  }
  await publish(
    ctx,
    expiredHolds.map((h) => ({
      type: 'hold.changed' as const,
      userId: h.userId,
      eventId: h.eventId,
      reason: 'expired' as const,
    })),
  );

  // 3. Heartbeat + lag
  const oldest = expired[0]?.holdExpiresAt;
  const lagMs = oldest ? now.getTime() - oldest.getTime() : 0;
  await JobLock.updateOne({ _id: LOCK }, { $set: { lastRunAt: now } });
  if (released.length || expiredHolds.length) {
    logger.info({ seats: released.length, holds: expiredHolds.length, lagMs }, 'hold.expired');
  }
  if (lagMs > 30_000) logger.warn({ lagMs }, 'sweeper lagging'); // FR-EXP-07

  return {
    skipped: false as const,
    seats: released.length,
    holds: expiredHolds.length,
    lagMs,
    released,
  };
}

// ---- runner ----
let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;
let startedAt = 0;

export function startSweeper() {
  startedAt = Date.now();
  timer = setInterval(() => {
    if (running) return; // never overlap runs
    running = sweepOnce()
      .catch((err) => logger.error({ err }, 'sweeper failed'))
      .finally(() => {
        running = null;
      });
  }, SWEEPER.intervalMs);
}

export async function stopSweeper() {
  if (timer) clearInterval(timer);
  await running; // let a running sweep finish (graceful shutdown)
}

/**
 * For /ready: this instance holds the lock, but hasn't finished a sweep for a while. A server that
 * has just started gets time to run its first sweep, even if the lock still shows an old run.
 */
export async function isSweeperStale(now = new Date()) {
  if (!env.SWEEPER_ENABLED) return false;
  const lock = await JobLock.findById(LOCK).lean();
  if (lock?.lockedBy !== INSTANCE_ID) return false;
  return now.getTime() - Math.max(lock.lastRunAt?.getTime() ?? 0, startedAt) > 30_000;
}
