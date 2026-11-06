import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './db/connection';
import { startSweeper, stopSweeper } from './jobs/holdSweeper';
import { logger } from './lib/logger';
import { attachSocketServer } from './realtime/socket';

const app = createApp();
const server = createServer(app);
const io = attachSocketServer(server);

await connectDb();
server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
if (env.SWEEPER_ENABLED) startSweeper();

let stopping = false;

/** NFR-REL-04: runs on every deploy. Requests in flight still need the database, so it closes last. */
async function shutdown(signal: string) {
  if (stopping) return; // a second signal mustn't start this again
  stopping = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.warn('shutdown took over 10 s: exiting anyway');
    process.exit(1);
  }, 10_000).unref();

  await stopSweeper(); // 1. no half-finished sweep
  await io.close(); // 2. drop sockets, stop accepting, finish what's in flight (this closes `server` too)
  await disconnectDb(); // 3. nothing needs the database now
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
