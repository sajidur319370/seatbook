import express from 'express';
import mongoose from 'mongoose';

export function createApp() {
  const app = express();

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

  return app;
}
