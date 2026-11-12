import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  APP_URL: z.url().default('http://localhost:5173'), // used in invite / reset links
  DEBUG_MONGO: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  TICKET_SIGNING_SECRET: z.string().min(32), // HMAC key for ticket codes (queries.md §11)
  RESEND_API_KEY: z.string().optional(), // production mail; without it, mail is only logged
  MAIL_FROM: z.string().default('SeatBook <tickets@seatbook.dev>'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900), // 15 min; set 30 in dev to test refresh
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Proxies between the visitor and this app. On Render, measured from its logs: Cloudflare, then
  // two hops inside Render. Wrong number: everyone shares one rate-limit bucket, or can fake an IP.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(3),
  SWEEPER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  HOLD_MINUTES_OVERRIDE: z.coerce.number().int().min(1).max(10).optional(), // dev only: shorter holds
  RATE_LIMITS: z.enum(['on', 'off']).default('on'), // 'off' only for the local load test
  SEED_DEMO_PASSWORD: z.string().min(8).optional(), // every demo account's password (Day 20 seed)
  SEED_ALLOW_PROD_RESET: z.string().optional(), // 'yes-really' lets the seed reset production
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

// NFR-SEC-04: one leaked secret must not let anyone both sign in as a user and print tickets.
if (env.TICKET_SIGNING_SECRET === env.JWT_ACCESS_SECRET) {
  console.error('❌ TICKET_SIGNING_SECRET must be different from JWT_ACCESS_SECRET');
  process.exit(1);
}

if (isProd && env.RATE_LIMITS === 'off') {
  console.error('❌ RATE_LIMITS=off is not allowed in production');
  process.exit(1);
}

if (isProd && env.HOLD_MINUTES_OVERRIDE) {
  console.error('❌ HOLD_MINUTES_OVERRIDE is not allowed in production');
  process.exit(1);
}
