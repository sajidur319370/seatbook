import { env } from '../config/env';
import { logger } from '../lib/logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Tests read this instead of a real inbox. */
export const outbox: Mail[] = [];

let muted = false;
/** The seed sends hundreds of booking emails to fake addresses: they help nobody. */
export const muteMail = () => {
  muted = true;
};

export function sendMail(mail: Mail): void {
  if (muted) return;
  if (env.NODE_ENV === 'test') {
    outbox.push(mail);
    return;
  }
  if (env.NODE_ENV === 'production' && env.RESEND_API_KEY) {
    // Fire and forget: the booking is already committed, so a mail failure is only logged.
    void fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      }),
    })
      .then((res) => {
        if (!res.ok) logger.error({ status: res.status, subject: mail.subject }, 'mail failed');
      })
      .catch((err) => logger.error({ err }, 'mail failed'));
    return;
  }
  // Fire and forget: a mail problem must never fail the request that triggered it.
  queueMicrotask(() => {
    logger.info({ to: mail.to, subject: mail.subject }, `📧 ${mail.subject}\n${mail.text}`);
  });
}
