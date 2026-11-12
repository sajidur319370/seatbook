/** NFR-REL-03 · TR-10: every invariant must report 0. Exit code 1 otherwise (used by CI). */
import { connectDb, disconnectDb } from '../src/db/connection';
import { checkInvariants } from '../src/ops/invariants';

await connectDb();
const report = await checkInvariants();
console.table(report.counts);
if (report.total) console.log('Samples:', JSON.stringify(report.samples, null, 2));
else console.log('✅ All invariants hold.');
await disconnectDb();
process.exit(report.total ? 1 : 0);
