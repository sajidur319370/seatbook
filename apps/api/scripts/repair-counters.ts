/** queries.md §16.1: recount events.counters. Dry run by default; --apply writes. */
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../src/db/connection';
import { repairCounters } from '../src/ops/counters';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
await connectDb();
const drift = await repairCounters({ apply: values.apply! });
if (drift.length) console.table(drift.map((d) => ({ ...d, eventId: String(d.eventId) })));
console.log(
  drift.length
    ? `${drift.length} counter(s) ${values.apply ? 'fixed' : 'drifted (run with --apply to fix)'}`
    : '✅ Counters match the data.',
);
await disconnectDb();
