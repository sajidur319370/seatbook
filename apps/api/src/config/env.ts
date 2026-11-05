import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  APP_URL: z.url().default('http://localhost:5173'), // used in invite / reset links
  DEBUG_MONGO: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
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
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

if (isProd && env.HOLD_MINUTES_OVERRIDE) {
  console.error('❌ HOLD_MINUTES_OVERRIDE is not allowed in production');
  process.exit(1);
}
