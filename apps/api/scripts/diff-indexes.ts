import { connectDb, disconnectDb } from '../src/db/connection';
import { diffAllIndexes } from '../src/db/indexes';

// Shows what db:sync-indexes would create and drop. Run it first in production.
await connectDb();
await diffAllIndexes();
await disconnectDb();
