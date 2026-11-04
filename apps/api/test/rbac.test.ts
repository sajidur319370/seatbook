import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { can, type Permission } from '@seatbook/shared';
import { app } from './setup/app';
import { as } from './helpers/auth';
import { makeAdmin, makeAttendee, makeOrganizer } from './helpers/roles';
import { OrganizerApplication } from '../src/db/models';

type Who = 'guest' | 'attendee' | 'organizer' | 'admin';
type Fixture = { applicationId: string; userId: string };
type Row = {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: (f: Fixture) => string;
  perm: Permission;
  body?: (f: Fixture) => object;
};

const ROWS: Row[] = [
  {
    name: 'apply',
    method: 'post',
    path: () => '/api/organizer-applications',
    perm: 'organizer:apply',
    body: () => ({
      organizationName: 'Test Org',
      message: 'We run theatre nights every month in Dhaka.',
    }),
  },
  {
    name: 'my application',
    method: 'get',
    path: () => '/api/organizer-applications/mine',
    perm: 'organizer:apply',
  },
  {
    name: 'list applications',
    method: 'get',
    path: () => '/api/admin/organizer-applications',
    perm: 'admin:applications',
  },
  {
    name: 'approve application',
    method: 'post',
    path: (f) => `/api/admin/organizer-applications/${f.applicationId}/approve`,
    perm: 'admin:applications',
  },
  {
    name: 'reject application',
    method: 'post',
    path: (f) => `/api/admin/organizer-applications/${f.applicationId}/reject`,
    perm: 'admin:applications',
    body: () => ({ reason: 'Not enough detail about your events.' }),
  },
  { name: 'list users', method: 'get', path: () => '/api/admin/users', perm: 'admin:users' },
  {
    name: 'suspend user',
    method: 'patch',
    path: (f) => `/api/admin/users/${f.userId}`,
    perm: 'admin:users',
    body: () => ({ suspended: true, reason: 'rbac test' }),
  },
  // Day 6+: event rows, Day 11: hold rows, Day 16: checkout, Day 18: check-in, Day 19: dashboards
];

describe('RBAC matrix', () => {
  let tokens: Record<Exclude<Who, 'guest'>, string>;
  let fixture: Fixture;

  beforeEach(async () => {
    tokens = {
      attendee: (await makeAttendee()).token,
      organizer: (await makeOrganizer()).token,
      admin: (await makeAdmin()).token,
    };
    const applicant = await makeAttendee('Applicant');
    const a = await OrganizerApplication.create({
      userId: applicant.user.id,
      organizationName: 'X Org',
      message: 'x'.repeat(30),
    });
    const victim = await makeAttendee('Victim');
    fixture = { applicationId: String(a._id), userId: victim.user.id };
  });

  for (const row of ROWS) {
    for (const who of ['guest', 'attendee', 'organizer', 'admin'] as Who[]) {
      it(`${row.name} as ${who}`, async () => {
        const req =
          who === 'guest'
            ? request(app)[row.method](row.path(fixture))
            : as(tokens[who])[row.method](row.path(fixture));
        const res = await (row.body ? req.send(row.body(fixture)) : req);

        if (who === 'guest') expect(res.status).toBe(401);
        else if (can(who, row.perm))
          expect([401, 403]).not.toContain(res.status); // allowed: business errors are fine
        else expect(res.status).toBe(403);
      });
    }
  }
});
