import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { PASSWORD } from './helpers/auth';
import { Session } from '../src/db/models';

/** The address the app saved for a login that arrived with this X-Forwarded-For header. */
async function ipSeenFor(forwardedFor: string) {
  const email = `ip-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', forwardedFor)
    .send({ name: 'Ip Check', email, password: PASSWORD });
  expect(res.status).toBe(201);
  const session = await Session.findOne().sort({ _id: -1 }).lean();
  return session!.ip;
}

// The real chain, read from Render's logs on the live site: visitor, Cloudflare, Render's network.
describe('working out the visitor address behind Render', () => {
  it('finds the visitor, not one of Render’s proxies', async () => {
    expect(await ipSeenFor('202.181.16.163, 172.69.78.168, 10.26.34.133')).toBe('202.181.16.163');
  });

  it('ignores an address the visitor made up, so nobody can dodge the rate limit', async () => {
    expect(await ipSeenFor('1.2.3.4, 202.181.16.163, 172.69.78.168, 10.26.34.133')).toBe(
      '202.181.16.163',
    );
  });
});
