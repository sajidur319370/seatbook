import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './setup/app';
import { eventInput } from './factories/events';
import { PASSWORD, as, refreshCookie } from './helpers/auth';
import { makeAdmin, makeAttendee, makeOrganizer } from './helpers/roles';
import { OrganizerApplication, Session, User } from '../src/db/models';
import { logger } from '../src/lib/logger';
import { outbox } from '../src/mail/mailer';

const APPLY = {
  organizationName: 'Dhaka Live',
  message: 'We organize 10 concerts a year in Dhaka.',
};
const REASON = 'Please add details about your past events.';

const apply = (token: string, body: object = APPLY) =>
  as(token).post('/api/organizer-applications').send(body);
const applicationUrl = (id: string, action: 'approve' | 'reject') =>
  `/api/admin/organizer-applications/${id}/${action}`;
const userUrl = (id: unknown) => `/api/admin/users/${String(id)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('roles & applications', () => {
  it('apply → approve → the SAME token now has the organizer role (AC-AUTH-06)', async () => {
    const rafi = await makeAttendee();
    const admin = await makeAdmin();
    const applied = await apply(rafi.token);
    expect(applied.status).toBe(201);

    const approve = await as(admin.token).post(
      applicationUrl(applied.body.application.id, 'approve'),
    );
    expect(approve.status).toBe(200);

    const me = await as(rafi.token).get('/api/me'); // no re-login
    expect(me.body.user.role).toBe('organizer');
    expect(me.body.user.organizationName).toBe('Dhaka Live');
    expect(me.body.application.status).toBe('approved');
    expect(outbox.at(-1)?.subject).toMatch(/create events/);
    const created = await as(rafi.token).post('/api/organizer/events').send(eventInput());
    expect(created.status).toBe(201);
  });

  it('only one pending application per user', async () => {
    const rafi = await makeAttendee();
    const [a, b] = await Promise.all([apply(rafi.token), apply(rafi.token)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).body.error.code).toBe('APPLICATION_PENDING');
    expect(await OrganizerApplication.countDocuments()).toBe(1);
  });

  it('two admins approving at once: exactly one wins (AC-APP-01)', async () => {
    const rafi = await makeAttendee();
    const [a1, a2] = [await makeAdmin('A1'), await makeAdmin('A2')];
    const { body } = await apply(rafi.token);
    const url = applicationUrl(body.application.id, 'approve');

    const [r1, r2] = await Promise.all([as(a1.token).post(url), as(a2.token).post(url)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('APPLICATION_ALREADY_REVIEWED');
    expect(loser.body.error.message).toBe('This application was already reviewed.');
    expect((await as(rafi.token).get('/api/me')).body.user.role).toBe('organizer');
  });

  it('approve and reject racing: one review wins and the role matches it', async () => {
    const rafi = await makeAttendee();
    const [a1, a2] = [await makeAdmin('A1'), await makeAdmin('A2')];
    const { body } = await apply(rafi.token);

    const [approved, rejected] = await Promise.all([
      as(a1.token).post(applicationUrl(body.application.id, 'approve')),
      as(a2.token).post(applicationUrl(body.application.id, 'reject')).send({ reason: REASON }),
    ]);
    expect([approved.status, rejected.status].sort()).toEqual([200, 409]);
    const me = (await as(rafi.token).get('/api/me')).body;
    expect(me.user.role).toBe(approved.status === 200 ? 'organizer' : 'attendee');
    expect(me.application.status).toBe(approved.status === 200 ? 'approved' : 'rejected');
  });

  it('organizers and admins cannot apply (FR-APP-04)', async () => {
    for (const user of [await makeOrganizer(), await makeAdmin()]) {
      const res = await apply(user.token);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_ORGANIZER');
    }
  });

  it('validates the application', async () => {
    const rafi = await makeAttendee();
    const res = await apply(rafi.token, {
      organizationName: 'X',
      website: 'javascript:alert(1)',
      message: 'too short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'message',
      'organizationName',
      'website',
    ]);
  });

  it('rejection is emailed and shown; re-applying waits 7 days (FR-APP-02, FR-APP-06)', async () => {
    const rafi = await makeAttendee();
    const admin = await makeAdmin();
    const { body } = await apply(rafi.token);

    const short = await as(admin.token)
      .post(applicationUrl(body.application.id, 'reject'))
      .send({ reason: 'no' });
    expect(short.status).toBe(400);

    const rejected = await as(admin.token)
      .post(applicationUrl(body.application.id, 'reject'))
      .send({ reason: REASON });
    expect(rejected.status).toBe(200);
    expect(outbox.at(-1)?.text).toContain(REASON);

    const me = await as(rafi.token).get('/api/me');
    expect(me.body.user.role).toBe('attendee');
    expect(me.body.application).toMatchObject({ status: 'rejected', rejectionReason: REASON });

    const tooSoon = await apply(rafi.token);
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.code).toBe('REAPPLY_TOO_SOON');

    await OrganizerApplication.updateOne(
      { _id: body.application.id },
      { $set: { reviewedAt: new Date(Date.now() - 8 * 86_400_000) } },
    );
    expect((await apply(rafi.token)).status).toBe(201);
  });

  it('reviewing a missing or reviewed application gives a clear error', async () => {
    const rafi = await makeAttendee();
    const admin = await makeAdmin();
    const { body } = await apply(rafi.token);
    const api = as(admin.token);

    expect((await api.post(applicationUrl(String(new Types.ObjectId()), 'approve'))).status).toBe(
      404,
    );
    expect((await api.post(applicationUrl('not-an-id', 'approve'))).status).toBe(400);

    await api.post(applicationUrl(body.application.id, 'approve'));
    const again = await api
      .post(applicationUrl(body.application.id, 'reject'))
      .send({ reason: REASON });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('APPLICATION_ALREADY_REVIEWED');
  });

  it('GET /mine returns the latest application or null', async () => {
    const rafi = await makeAttendee();
    const mine = () => as(rafi.token).get('/api/organizer-applications/mine');
    expect((await mine()).body.application).toBeNull();
    await apply(rafi.token);
    expect((await mine()).body.application).toMatchObject({
      status: 'pending',
      organizationName: 'Dhaka Live',
    });
  });

  it('the queue is oldest first, paginated, and shows who applied', async () => {
    const admin = await makeAdmin();
    const rafi = await makeAttendee('Rafi');
    await apply(rafi.token);
    await OrganizerApplication.insertMany(
      Array.from({ length: 50 }, (_, i) => ({
        userId: new Types.ObjectId(),
        organizationName: `Org ${i}`,
        message: 'x'.repeat(30),
      })),
    );
    const url = '/api/admin/organizer-applications';

    const first = await as(admin.token).get(url);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].userId).toMatchObject({ name: 'Rafi', email: rafi.email });
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await as(admin.token).get(`${url}?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((a: { _id: string }) => a._id);
    expect(new Set(ids).size).toBe(51);

    const bad = await as(admin.token).get(`${url}?cursor=garbage`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('admin: users', () => {
  it('an admin cannot suspend another admin (AC-ADM-01)', async () => {
    const [a1, a2] = [await makeAdmin('A1'), await makeAdmin('A2')];
    const res = await as(a1.token)
      .patch(userUrl(a2.user.id))
      .send({ suspended: true, reason: 'nope nope' });
    expect(res.status).toBe(403);
    expect((await User.findById(a2.user.id).lean())?.suspendedAt).toBeNull();
  });

  it('every change to an admin or to yourself is refused (FR-ADM-04)', async () => {
    const [a1, a2] = [await makeAdmin('A1'), await makeAdmin('A2')];
    const api = as(a1.token);
    expect((await api.patch(userUrl(a2.user.id)).send({ role: 'attendee' })).status).toBe(403);
    expect((await api.patch(userUrl(a2.user.id)).send({ suspended: false })).status).toBe(403);
    expect(
      (await api.patch(userUrl(a1.user.id)).send({ suspended: true, reason: 'myself' })).status,
    ).toBe(403);
    expect((await User.findById(a2.user.id).lean())?.role).toBe('admin');
  });

  it('every kind of change to an unknown user → 404, never 200 with a null user', async () => {
    const admin = await makeAdmin();
    const url = userUrl(new Types.ObjectId());
    for (const body of [
      { role: 'organizer' },
      { suspended: true, reason: 'nobody here' },
      { suspended: false },
    ]) {
      expect((await as(admin.token).patch(url).send(body)).status).toBe(404);
    }
  });

  it('suspension applies on the next request and kills refresh', async () => {
    const admin = await makeAdmin();
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Bot', email: 'bot@test.dev', password: PASSWORD });
    const token = reg.body.accessToken;

    await as(admin.token)
      .patch(userUrl(reg.body.user.id))
      .send({ suspended: true, reason: 'hoarding seats' });
    expect(outbox.at(-1)?.text).toContain('hoarding seats');

    const me = await as(token).get('/api/me');
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');

    const refresh = await agent.post('/api/auth/refresh');
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(refresh.get('Set-Cookie')?.join()).toContain('sb_refresh=;'); // the cookie is cleared

    expect(await Session.countDocuments({ userId: reg.body.user.id, revokedAt: null })).toBe(0);
  });

  it('a suspended user cannot log in, and only hears why with the right password', async () => {
    const admin = await makeAdmin();
    const rafi = await makeAttendee();
    await as(admin.token)
      .patch(userUrl(rafi.user.id))
      .send({ suspended: true, reason: 'hoarding seats' });
    const login = (password: string) =>
      request(app).post('/api/auth/login').send({ email: rafi.email, password });

    const right = await login(PASSWORD);
    expect(right.status).toBe(403);
    expect(right.body.error).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      message: 'This account is suspended.',
    });
    expect((await login('Wrong1234')).body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('suspending twice → 409; unsuspending allows login but old sessions stay dead', async () => {
    const admin = await makeAdmin();
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Back', email: 'back@test.dev', password: PASSWORD });
    const oldCookie = refreshCookie(reg);
    const url = userUrl(reg.body.user.id);
    const suspend = { suspended: true, reason: 'a short break' };

    expect((await as(admin.token).patch(url).send(suspend)).status).toBe(200);
    const twice = await as(admin.token).patch(url).send(suspend);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ALREADY_SUSPENDED');

    const back = await as(admin.token).patch(url).send({ suspended: false });
    expect(back.status).toBe(200);
    expect(back.body.user.suspendedAt).toBeNull();

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(refresh.status).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'back@test.dev', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('role changes apply to the same token, in both directions', async () => {
    const admin = await makeAdmin();
    const rafi = await makeAttendee();
    const role = async () => (await as(rafi.token).get('/api/me')).body.user.role;

    await as(admin.token).patch(userUrl(rafi.user.id)).send({ role: 'organizer' });
    expect(await role()).toBe('organizer');
    await as(admin.token).patch(userUrl(rafi.user.id)).send({ role: 'attendee' });
    expect(await role()).toBe('attendee');
  });

  it('nobody can grant admin through the API', async () => {
    const admin = await makeAdmin();
    const rafi = await makeAttendee();
    const res = await as(admin.token).patch(userUrl(rafi.user.id)).send({ role: 'admin' });
    expect(res.status).toBe(400); // the schema only allows attendee | organizer
    expect((await User.findById(rafi.user.id).lean())?.role).toBe('attendee');
  });

  it('a PATCH with nothing to change → 400', async () => {
    const admin = await makeAdmin();
    const rafi = await makeAttendee();
    const res = await as(admin.token).patch(userUrl(rafi.user.id)).send({ reason: 'only this' });
    expect(res.status).toBe(400);
  });

  it('the list filters, treats search text literally, and never exposes hashes', async () => {
    const admin = await makeAdmin('Arif Admin');
    await makeOrganizer('Nadia Stage');
    const bot = await makeAttendee('Bot Hoarder');
    await as(admin.token)
      .patch(userUrl(bot.user.id))
      .send({ suspended: true, reason: 'hoarding seats' });

    const list = async (query: string) => {
      const res = await as(admin.token).get(`/api/admin/users?${query}`);
      expect(res.status).toBe(200);
      return res.body.items.map((u: { name: string }) => u.name) as string[];
    };

    expect(await list('q=nadia')).toEqual(['Nadia Stage']);
    expect(await list('role=organizer')).toEqual(['Nadia Stage']);
    expect(await list('suspended=true')).toEqual(['Bot Hoarder']);
    expect((await list('suspended=false')).sort()).toEqual(['Arif Admin', 'Nadia Stage']);
    expect(await list(`q=${encodeURIComponent('.*')}`)).toEqual([]);

    const all = await as(admin.token).get('/api/admin/users');
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await as(admin.token).get('/api/admin/users?role=superuser')).status).toBe(400);
  });

  it('the list pages through every user with a cursor', async () => {
    const admin = await makeAdmin();
    await User.insertMany(
      Array.from({ length: 51 }, (_, i) => ({
        email: `bulk${i}@test.dev`,
        name: `Bulk ${i}`,
        passwordHash: 'x',
      })),
    );

    const first = await as(admin.token).get('/api/admin/users');
    expect(first.body.items).toHaveLength(50);
    const second = await as(admin.token).get(`/api/admin/users?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(2); // the 51 + the admin
    expect(second.body.nextCursor).toBeNull();
  });

  it('a denied write is logged with who tried what; a denied read is not (FR-RBAC-07)', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const rafi = await makeAttendee();

    await as(rafi.token).get('/api/admin/users');
    expect(warn).not.toHaveBeenCalled();

    const denied = await as(rafi.token).patch(userUrl(rafi.user.id)).send({ role: 'organizer' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toEqual({ permission: 'admin:users' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      userId: rafi.user.id,
      role: 'attendee',
      permission: 'admin:users',
    });
  });
});

describe('authenticate', () => {
  it('a valid token for a deleted user → 401', async () => {
    const rafi = await makeAttendee();
    await User.deleteOne({ _id: rafi.user.id });
    expect((await as(rafi.token).get('/api/me')).status).toBe(401);
  });
});
