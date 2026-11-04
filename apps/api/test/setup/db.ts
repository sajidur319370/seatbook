import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { syncAllIndexes } from '../../src/db/indexes';

let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('seatbook_test'));
  await syncAllIndexes(); // unique & partial indexes must exist: tests rely on them
}

export async function clearTestDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}
