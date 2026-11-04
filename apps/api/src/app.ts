import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env } from './config/env';
import { httpLogger } from './lib/httpLogger';
import { rejectDollarKeys } from './middleware/rejectDollarKeys';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: correct req.ip for rate limits, secure cookies
  app.disable('x-powered-by');

  app.use(httpLogger);
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rejectDollarKeys);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/ready', async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db!.admin().ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler); // must be after all routes
  app.use(errorHandler); // must be last
  return app;
}
