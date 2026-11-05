import { SWEEPER } from '@seatbook/shared';
import { connectDb, disconnectDb } from '../src/db/connection';
import { sweepOnce } from '../src/jobs/holdSweeper';

// If the sweeper was down for a long time. Holds stay correct without this (lazy expiry): it only
// catches the database up, in batches.
await connectDb();
let total = 0;
for (;;) {
  const r = await sweepOnce(new Date(), 'repair-script');
  if (r.skipped) {
    console.log('Another instance holds the lock; try again in 30 s.');
    process.exitCode = 1;
    break;
  }
  total += r.seats;
  if (r.seats < SWEEPER.batchSize) break;
}
console.log(`Released ${total} seats`);
await disconnectDb();
