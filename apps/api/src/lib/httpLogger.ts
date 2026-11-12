import { randomUUID } from 'node:crypto';
import { pinoHttp, type Options } from 'pino-http';
import { logger } from './logger';

/** Exported so the redaction test (NFR-OBS-02) runs the REAL settings against a captured stream. */
export const httpLoggerOptions: Options = {
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && incoming.length < 100 ? incoming : `req_${randomUUID()}`;
    res.setHeader('x-request-id', id);
    return id;
  },
  // AC-AUTH-05: Express serves the web app in production, so a reset link's URL reaches this logger
  // with the live token in it.
  autoLogging: { ignore: (req) => req.url?.startsWith('/reset-password/') ?? false },
  // AC-AUTH-05: tokens and cookies must never appear in logs. The Idempotency-Key replays a payment.
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["idempotency-key"]',
    'req.body.code', // check-in codes (FR-TKT-09). pino-http logs no bodies; this is a safety net.
    'res.headers["set-cookie"]',
  ],
};

export const httpLogger = pinoHttp({ logger, ...httpLoggerOptions });
