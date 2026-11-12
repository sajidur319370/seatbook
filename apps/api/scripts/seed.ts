/**
 * The demo data (FR-UI-09, database.md §10). The work is in src/ops/seed.ts; this adds the safety
 * checks, the optional reset and the final consistency proof.
 *
 *   npm run seed                    a fresh database only
 *   npm run seed -- --reset         drop EVERYTHING in MONGODB_URI's database first
 *   npm run seed -- --reset --big   plus the 5,000-seat event
 *
 * Production (the public demo) only with SEED_ALLOW_PROD_RESET=yes-really (Day 20 Step 9a).
 */
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import { JobLock, User } from '../src/db/models';
import { LOCK } from '../src/jobs/holdSweeper';
import { muteMail } from '../src/mail/mailer';
import { repairCounters } from '../src/ops/counters';
import { checkInvariants } from '../src/ops/invariants';
import { DEMO, seedDemo, seedToday } from '../src/ops/seed';

const { values: flags } = parseArgs({
  options: { reset: { type: 'boolean' }, big: { type: 'boolean' } },
});

if (env.NODE_ENV === 'production' && env.SEED_ALLOW_PROD_RESET !== 'yes-really') {
  console.error(
    'Refusing to seed production. Set SEED_ALLOW_PROD_RESET=yes-really to reset the demo.',
  );
  process.exit(1);
}
if (!env.SEED_DEMO_PASSWORD) {
  console.error('Set SEED_DEMO_PASSWORD (8+ characters, a letter and a digit) in apps/api/.env');
  process.exit(1);
}

const t0 = Date.now();
await connectDb();
const db = mongoose.connection.db!.databaseName;
if (flags.reset) {
  console.log(`Dropping database "${db}"…`);
  await mongoose.connection.dropDatabase();
} else if (await User.exists({ email: DEMO('admin') })) {
  console.error('Already seeded. Run with --reset to start over (it deletes ALL data).');
  await disconnectDb();
  process.exit(1);
}
await syncAllIndexes();
muteMail(); // hundreds of booking emails to fake addresses help nobody

/*
 * Pause any RUNNING server's sweeper (the live demo's): every hold the seed makes on a past day
 * looks long expired, and a sweeper running every 5 s would free its seats mid-purchase. The
 * sweeper's own lease lock is the off switch: hold it, renew it, give it back at the end. A server
 * whose lock someone else holds stays healthy (/ready).
 */
const takeLease = () =>
  JobLock.updateOne(
    { _id: LOCK },
    {
      $set: { lockedBy: 'seed', lockedUntil: new Date(Date.now() + 60_000), lastRunAt: new Date() },
    },
    { upsert: true },
  );
await takeLease();
// Keep the latest renewal: one still in flight at the end could land AFTER the release below and
// pause the server's sweeper for another minute.
let renewing: Promise<unknown> = Promise.resolve();
const renew = setInterval(() => {
  renewing = takeLease().catch(() => {});
}, 10_000);
try {
  await seedDemo({ password: env.SEED_DEMO_PASSWORD, big: flags.big, log: console.log });
} finally {
  clearInterval(renew);
  await renewing; // let a renewal already on its way land first, then release
  await JobLock.updateOne({ _id: LOCK, lockedBy: 'seed' }, { $set: { lockedUntil: new Date(0) } });
}

// Display counters are bumped after commit; recount anyway, then prove the data is consistent.
await repairCounters({ apply: true });
const report = await checkInvariants();
await disconnectDb();
if (report.total) {
  console.error('Seed produced invariant violations:', report.counts);
  process.exit(1);
}
console.log(
  `✅ Seeded "${db}" in ${Math.round((Date.now() - t0) / 1000)} s (today is ${seedToday()} in Dhaka). ` +
    `Log in as ${DEMO('organizer')}, ${DEMO('attendee')} or ${DEMO('admin')} with SEED_DEMO_PASSWORD.`,
);
