import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from './logger';

export const httpLogger = pinoHttp({
  logger,
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
  // AC-AUTH-05: tokens and cookies must never appear in logs
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
