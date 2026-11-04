import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb } from './db/connection';
import { logger } from './lib/logger';

const app = createApp();
const server = createServer(app); // a raw http server: Socket.io attaches to it on Day 14

await connectDb();
server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
