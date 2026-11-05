import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler';
import { httpLogger } from '../src/lib/httpLogger';
import { serveWebApp } from '../src/lib/serveWebApp';

describe('serving the web app', () => {
  let dist: string;
  let app: express.Express;

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), 'seatbook-dist-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<html>the app</html>');
    writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
    writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');

    app = express();
    app.use(httpLogger);
    app.get('/api/real', (_req, res) => {
      res.json({ ok: true });
    });
    serveWebApp(app, dist);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it.each(['/', '/e/hamlet-k7qx', '/organizer/events/123', '/reset-password/some-token'])(
    'a deep link %s gets the app, uncached',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('the app');
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('a hashed asset is cached forever', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cache-control']).toContain('max-age=31536000');
  });

  it('a file without a hash is not cached forever', async () => {
    const res = await request(app).get('/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).not.toContain('immutable');
  });

  it.each(['/assets/index-old999.js', '/robots.txt'])(
    'a missing file %s is a real 404, not the app',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('the app');
    },
  );

  it('API routes still work, and an unknown one is a JSON 404', async () => {
    expect((await request(app).get('/api/real')).body).toEqual({ ok: true });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not answer Socket.io paths with the app', async () => {
    const res = await request(app).get('/socket.io/');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('the app');
  });
});
