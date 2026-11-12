import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env, isProd } from './config/env';
import { isSweeperStale } from './jobs/holdSweeper';
import { httpLogger } from './lib/httpLogger';
import { serveWebApp } from './lib/serveWebApp';
import { rejectDollarKeys } from './middleware/rejectDollarKeys';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY_HOPS); // correct req.ip for rate limits, secure cookies
  app.disable('x-powered-by');

  app.use(httpLogger);
  // NFR-SEC-06/10. The CSP only reaches pages Express serves (production); Vite serves dev pages.
  const socketOrigin = new URL(env.APP_URL).origin.replace(/^http/, 'ws'); // https://x → wss://x
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false, // every directive listed here, nothing implicit
        directives: {
          defaultSrc: ["'self'"],
          // The door scanner compiles a WebAssembly QR decoder on browsers without a built-in
          // BarcodeDetector (iPhones). This allows compiling WASM; it does NOT allow eval().
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Radix and Recharts set inline style attributes
          imgSrc: ["'self'", 'data:'], // ticket QR codes are data: URLs
          connectSrc: ["'self'", socketOrigin], // REST + Socket.io (older Safari: wss: isn't 'self')
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"], // nobody may frame the checkout
          ...(isProd && { upgradeInsecureRequests: [] }),
        },
      },
      strictTransportSecurity: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use((_req, res, next) => {
    // The scanner needs the camera; nothing needs the microphone or location.
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });
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
      if (await isSweeperStale()) {
        res.status(503).json({ ok: false, reason: 'sweeper' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', apiRouter);

  // apps/api/dist → apps/web/dist
  if (isProd) serveWebApp(app, path.resolve(import.meta.dirname, '../../web/dist'));

  app.use(notFoundHandler); // must be after all routes
  app.use(errorHandler); // must be last
  return app;
}
