import { env } from '../config/env';
import { logger } from '../lib/logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Tests read this instead of a real inbox. */
export const outbox: Mail[] = [];

export function sendMail(mail: Mail): void {
  if (env.NODE_ENV === 'test') {
    outbox.push(mail);
    return;
  }
  // Fire and forget: a mail problem must never fail the request that triggered it.
  queueMicrotask(() => {
    logger.info({ to: mail.to, subject: mail.subject }, `📧 ${mail.subject}\n${mail.text}`);
  });
}
