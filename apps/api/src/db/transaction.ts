import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs fn inside a transaction. The driver retries fn on transient errors
 * (write conflicts), so fn must be safe to run more than once:
 * no socket emits, no emails, no payment calls inside it.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } finally {
    await session.endSession();
  }
}
