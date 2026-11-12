import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { httpLoggerOptions } from '../src/lib/httpLogger';

/**
 * NFR-OBS-02 / AC-AUTH-05 / FR-TKT-09: secrets never reach the logs. The REAL request-logger
 * settings, writing into a buffer at 'info' (the test logger is silent), on requests that carry
 * every secret a SeatBook request can carry.
 */
function capturingApp() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ ...httpLoggerOptions, logger: pino({ level: 'info' }, sink) }));
  app.post('/api/auth/login', (_req, res) => {
    res.cookie('sb_refresh', 'refresh-SECRET-123', { httpOnly: true }).json({ accessToken: 'x' });
  });
  app.post('/api/check-in', (_req, res) => {
    res.json({ result: 'ok' });
  });
  app.get('/reset-password/:token', (_req, res) => {
    res.send('<html></html>');
  });
  return { app, text: () => lines.join('\n') };
}

describe('log redaction (NFR-OBS-02)', () => {
  it('keeps tokens, cookies, payment keys and ticket codes out of the request log', async () => {
    const { app, text } = capturingApp();
    await request(app)
      .post('/api/auth/login')
      .set('Authorization', 'Bearer access-SECRET-abc')
      .set('Cookie', 'sb_refresh=old-refresh-SECRET-xyz')
      .send({ email: 'a@b.dev', password: 'Passw0rd-SECRET' });
    await request(app)
      .post('/api/check-in')
      .set('Idempotency-Key', '7f6c1d2e-SECRET-key')
      .send({ code: 'SB1.ticket-CODE-SECRET', method: 'qr' });
    await request(app).get('/reset-password/reset-TOKEN-SECRET');

    const log = text();
    expect(log).toContain('request completed'); // it did log the requests…
    expect(log).toContain('[Redacted]'); // …with the secrets masked
    expect(log).not.toMatch(/SECRET/); // none of them, anywhere
    expect(log).not.toContain('Bearer ');
    expect(log).not.toContain('sb_refresh=');
  });
});
