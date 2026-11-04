import mongoose from 'mongoose';
import { env, isProd } from '../config/env';
import { logger } from '../lib/logger';

mongoose.set('strictQuery', true); // unknown filter fields are dropped, not passed through

export async function connectDb(uri = env.MONGODB_URI) {
  if (env.DEBUG_MONGO) mongoose.set('debug', true);
  await mongoose.connect(uri, { autoIndex: !isProd }); // prod builds indexes via a script (Day 20)
  logger.info('MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
