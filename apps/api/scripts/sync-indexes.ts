import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';

// Production has autoIndex off, so unique indexes don't exist until this runs.
await connectDb();
await syncAllIndexes();
console.log('✅ Indexes are in sync');
await disconnectDb();
