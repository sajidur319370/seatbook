import path from 'node:path';
import express, { type Express } from 'express';

/**
 * Production only: one origin for the app and the API, so the refresh cookie is first-party and
 * WebSockets need no CORS (requirement C-6). Mount after the API routes, before the 404 handler.
 */
export function serveWebApp(app: Express, dist: string) {
  // Hashed filenames never change, so browsers may keep them forever.
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));

  app.get('/{*splat}', (req, res, next) => {
    // A missing file must be a real 404. After a deploy, a tab still open on the old version asks
    // for a chunk that's gone: answering with index.html would break it with a confusing MIME error.
    const isFile = path.extname(req.path) !== '';
    if (isFile || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')); // SPA fallback
  });
}
