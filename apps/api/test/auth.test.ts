import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './setup/app';
import { PASSWORD, as, refreshCookie, registerUser } from './helpers/auth';
import { Session, User } from '../src/db/models';
import { env } from '../src/config/env';
import { sha256 } from '../src/lib/crypto';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth', () => {
  it('register → /me works with the access token', async () => {
    const { token, email } = await registerUser('Rahim');
    const me = await as(token).get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ name: 'Rahim', email, role: 'attendee' }); // FR-AUTH-01
  });

  it('duplicate email in any letter case → 409 EMAIL_TAKEN (AC-AUTH-01)', async () => {
    const { email } = await registerUser();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('wrong password and unknown email give the same error', async () => {
    const { email } = await registerUser();
    const a = await request(app).post('/api/auth/login').send({ email, password: 'Wrong1234' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.dev', password: 'Wrong1234' });
    expect(a.status).toBe(401);
    expect(a.body.error).toMatchObject({ code: b.body.error.code, message: b.body.error.message });
  });

  it('refresh rotates the token; replaying the old one revokes the family (AC-AUTH-03)', async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'A', email: 'rot@test.dev', password: PASSWORD });
    const oldCookie = refreshCookie(reg);

    const r1 = await agent.post('/api/auth/refresh'); // agent now holds the NEW cookie
    expect(r1.status).toBe(200);
    expect(refreshCookie(r1)).not.toBe(oldCookie);

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    const r2 = await agent.post('/api/auth/refresh'); // the new session died too
    expect(r2.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ name: 'A', email: 'out@test.dev', password: PASSWORD });
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('forgot always 200; reset works once and kills old sessions (AC-AUTH-04)', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ name: 'A', email: 'reset@test.dev', password: PASSWORD });

    expect(
      (await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.dev' }))
        .status,
    ).toBe(200);

    // Plant a known token instead of reading the console.
    await User.updateOne(
      { email: 'reset@test.dev' },
      {
        $set: {
          passwordResetTokenHash: sha256('known-token-known-token'),
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        },
      },
    );
    const body = { token: 'known-token-known-token', password: 'NewPassw0rd' };
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(400); // single use
    expect((await agent.post('/api/auth/refresh')).status).toBe(401); // old session revoked

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@test.dev', password: 'NewPassw0rd' });
    expect(login.status).toBe(200);
  });

  it('never leaks hashes or tokens in responses (AC-AUTH-05)', async () => {
    const { token } = await registerUser();
    const me = await as(token).get('/api/me');
    const json = JSON.stringify(me.body);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toMatch(/\$2[aby]\$/); // bcrypt prefix
  });

  it('weak password → 400 with field details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'w@test.dev', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('password');
  });
});

describe('access tokens', () => {
  const noneAlgToken = (sub: string) => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub, sid: 'x' })}.`;
  };

  it('carry only sub and sid, with no role (FR-AUTH-04)', async () => {
    const { token, user } = await registerUser();
    const claims = jwt.decode(token) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    expect(claims.sub).toBe(user.id);
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
  });

  it('a missing token → 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('an expired token → 401 TOKEN_EXPIRED, so the client knows to refresh (AC-AUTH-02)', async () => {
    const { user } = await registerUser();
    const expired = jwt.sign({ sid: 'x' }, env.JWT_ACCESS_SECRET, {
      subject: user.id,
      expiresIn: -10,
    });
    const res = await as(expired).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('a token signed with the wrong secret or with alg=none → 401', async () => {
    const { user } = await registerUser();
    const forged = jwt.sign({ sid: 'x' }, 'not-the-real-secret-not-the-real-secret', {
      subject: user.id,
    });
    for (const bad of [forged, noneAlgToken(user.id)]) {
      const res = await as(bad).get('/api/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('refresh tokens', () => {
  it('the cookie is httpOnly, Lax and scoped to /api/auth (FR-AUTH-04)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'c@test.dev', password: PASSWORD });
    const raw = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('sb_refresh='))!;
    expect(raw).toContain('Path=/api/auth');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(JSON.stringify(res.body)).not.toContain(refreshCookie(res).split('=')[1]);
  });

  it('only the hash is stored (FR-AUTH-05)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'h@test.dev', password: PASSWORD });
    const token = refreshCookie(res).split('=')[1]!;
    const sessions = await Session.find().lean();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(sessions)).not.toContain(token);
  });

  it('5 parallel refreshes with one token → exactly one wins', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'race@test.dev', password: PASSWORD });
    const cookie = refreshCookie(reg);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/auth/refresh').set('Cookie', cookie)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
    expect(await Session.countDocuments()).toBe(2); // the original + one rotation
  });

  it('an expired session → 401 TOKEN_EXPIRED', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'old@test.dev', password: PASSWORD });
    await Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('a rejected token clears the cookie; a server error keeps it', async () => {
    const rejected = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sb_refresh=not-a-real-token');
    expect(rejected.status).toBe(401);
    expect(rejected.get('Set-Cookie')?.join()).toContain('sb_refresh=;');

    vi.spyOn(Session, 'findOne').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    const failed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sb_refresh=some-token');
    expect(failed.status).toBe(500);
    expect(failed.get('Set-Cookie')).toBeUndefined();
  });

  it('logout-all ends every login of that user, and only that user', async () => {
    const email = 'all@test.dev';
    const first = request.agent(app);
    const second = request.agent(app);
    const reg = await first
      .post('/api/auth/register')
      .send({ name: 'A', email, password: PASSWORD });
    await second.post('/api/auth/login').send({ email, password: PASSWORD });

    const other = request.agent(app);
    await other
      .post('/api/auth/register')
      .send({ name: 'B', email: 'other@test.dev', password: PASSWORD });

    expect((await as(reg.body.accessToken).post('/api/auth/logout-all')).status).toBe(204);
    expect((await first.post('/api/auth/refresh')).status).toBe(401);
    expect((await second.post('/api/auth/refresh')).status).toBe(401);
    expect((await other.post('/api/auth/refresh')).status).toBe(200);
  });
});

describe('password reset', () => {
  it('forgot gives the same answer for known and unknown emails, and stores only a hash', async () => {
    const { email } = await registerUser();
    const known = await request(app).post('/api/auth/forgot-password').send({ email });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.dev' });
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);

    const user = await User.findOne({ email })
      .select('+passwordResetTokenHash +passwordResetExpiresAt')
      .lean();
    expect(user?.passwordResetTokenHash).toMatch(/^[a-f0-9]{64}$/);
    const minutesLeft = (user!.passwordResetExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(29);
    expect(minutesLeft).toBeLessThanOrEqual(30);
  });

  it('an expired reset token → 400', async () => {
    const { email } = await registerUser();
    await User.updateOne(
      { email },
      {
        $set: {
          passwordResetTokenHash: sha256('expired-token-expired-token'),
          passwordResetExpiresAt: new Date(Date.now() - 1000),
        },
      },
    );
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'expired-token-expired-token', password: 'NewPassw0rd' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });
});

describe('/me', () => {
  it('PATCH updates the profile but can never set a role', async () => {
    const { token, email } = await registerUser();
    const res = await as(token)
      .patch('/api/me')
      .send({ name: 'New Name', timezone: 'Asia/Dhaka', avatarColor: 'teal', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: 'New Name',
      timezone: 'Asia/Dhaka',
      avatarColor: 'teal',
      role: 'attendee',
    });
    expect((await User.findOne({ email }).lean())?.role).toBe('attendee');
  });

  it('PATCH rejects an unknown time zone and colour', async () => {
    const { token } = await registerUser();
    const res = await as(token).patch('/api/me').send({ timezone: 'Mars/Base', avatarColor: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'avatarColor',
      'timezone',
    ]);
  });

  it('register ignores a role sent by the client', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'sneaky@test.dev', password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('attendee');
  });

  it('change password needs the current one and ends other logins, not this one (FR-AUTH-13)', async () => {
    const email = 'change@test.dev';
    const here = request.agent(app);
    const elsewhere = request.agent(app);
    const reg = await here
      .post('/api/auth/register')
      .send({ name: 'A', email, password: PASSWORD });
    await elsewhere.post('/api/auth/login').send({ email, password: PASSWORD });
    const newPassword = 'Changed1234';

    const wrong = await as(reg.body.accessToken)
      .patch('/api/me/password')
      .send({ currentPassword: 'Wrong1234', newPassword });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');

    const ok = await as(reg.body.accessToken)
      .patch('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword });
    expect(ok.status).toBe(200);

    expect((await elsewhere.post('/api/auth/refresh')).status).toBe(401);
    expect((await here.post('/api/auth/refresh')).status).toBe(200);

    const login = (password: string) =>
      request(app).post('/api/auth/login').send({ email, password });
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login(newPassword)).status).toBe(200);
  });
});
