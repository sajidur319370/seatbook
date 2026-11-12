import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './setup/app';
import { validate, valid } from '../src/middleware/validate';
import { errorHandler, toAppError } from '../src/middleware/errorHandler';
import { httpLogger } from '../src/lib/httpLogger';
import { withTransaction } from '../src/db/transaction';
import { Session, User } from '../src/db/models';
import { toUserDto } from '../src/modules/users/user.dto';

describe('backbone', () => {
  it('GET /health → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /ready → 200 when the database is reachable', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
  });

  it('CSP: own origin only, plus WASM for the door scanner (no eval, no CDN)', async () => {
    const csp = (await request(app).get('/health')).headers['content-security-policy'] as string;
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));
    expect(directive('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('img-src')).toContain('data:'); // ticket QR codes are data: URLs (Day 17)
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/jsdelivr|unpkg/);
    // Day 20: the full policy (NFR-SEC-06/10)
    expect(directive('connect-src')).toBe("connect-src 'self' ws://localhost:5173");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('form-action')).toBe("form-action 'self'");
  });

  it('camera only, and no HSTS outside production (Render terminates TLS in production)', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('puts x-request-id on successful responses too', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it('unknown route → 404 in the standard error format', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('malformed JSON → 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/x')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('oversized body → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/x')
      .send({ a: 'x'.repeat(101 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects $-keys in the body', async () => {
    const res = await request(app)
      .post('/api/x')
      .send({ email: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('validate() parses and types the body', async () => {
    const schemas = { body: z.object({ n: z.number().int() }) };
    const mini = express()
      .use(express.json())
      .post('/x', validate(schemas), (req, res) => {
        res.json(valid(req, schemas).body);
      })
      .use(errorHandler);

    expect((await request(mini).post('/x').send({ n: 3 })).body).toEqual({ n: 3 });
    const bad = await request(mini).post('/x').send({ n: 'three' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details[0].field).toBe('n');
  });

  it('an error thrown in an async handler → generic 500 that hides the real message', async () => {
    const mini = express()
      .use(httpLogger)
      .get('/boom', async () => {
        throw new Error('secret database detail');
      })
      .use(errorHandler);

    const res = await request(mini).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('withTransaction rolls back when the callback throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await User.create([{ email: 'a@test.dev', name: 'A', passwordHash: 'x' }], { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await User.countDocuments()).toBe(0);
  });

  it('withTransaction commits and returns the callback result', async () => {
    const email = await withTransaction(async (session) => {
      const [user] = await User.create([{ email: 'b@test.dev', name: 'B', passwordHash: 'x' }], {
        session,
      });
      return user!.email;
    });
    expect(email).toBe('b@test.dev');
    expect(await User.countDocuments()).toBe(1);
  });
});

describe('users and sessions', () => {
  it('a duplicate email maps to 409 EMAIL_TAKEN through the uniq_email index', async () => {
    await User.create({ email: 'dup@test.dev', name: 'A', passwordHash: 'x' });
    const err = await User.create({ email: 'DUP@test.dev', name: 'B', passwordHash: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(toAppError(err)).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
  });

  it('an unmapped duplicate key is a 500, not a client error', async () => {
    const userId = (await User.create({ email: 'c@test.dev', name: 'C', passwordHash: 'x' }))._id;
    const session = { userId, familyId: 'f', tokenHash: 'same', expiresAt: new Date() };
    await Session.create(session);
    const err = await Session.create(session).catch((e: unknown) => e);
    expect(toAppError(err)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('secret fields are hidden from reads and from the DTO', async () => {
    await User.create({ email: 'd@test.dev', name: 'D', passwordHash: 'hash' });
    const user = await User.findOne({ email: 'd@test.dev' }).lean();
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('passwordResetTokenHash');

    const dto = toUserDto(user!);
    expect(Object.keys(dto).sort()).toEqual([
      'avatarColor',
      'email',
      'id',
      'name',
      'organizationName',
      'role',
      'timezone',
    ]);
    expect(dto.role).toBe('attendee');
  });

  it('sessions have a TTL index that expires them at expiresAt', async () => {
    const indexes = await Session.collection.indexes();
    const ttl = indexes.find((i) => i.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(0);
  });
});
