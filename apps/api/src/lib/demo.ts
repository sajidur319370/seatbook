import { env } from '../config/env';
import { forbidden } from './errors';

/** Every account the seed makes lives on this domain (organizer@, attendee@, buyer01@, …). */
export const DEMO_DOMAIN = 'demo.seatbook.dev';

export const isDemoEmail = (email: string) => email.toLowerCase().endsWith(`@${DEMO_DOMAIN}`);

/**
 * The public demo shows its password on the login page, so with DEMO_LOCK=true nobody can change
 * a demo account's password or profile and lock the next visitor out. Real accounts are untouched.
 */
export function assertNotLockedDemo(email: string) {
  if (env.DEMO_LOCK && isDemoEmail(email)) {
    throw forbidden(
      'DEMO_ACCOUNT_LOCKED',
      "Demo accounts are shared, so their password and profile can't be changed.",
    );
  }
}
