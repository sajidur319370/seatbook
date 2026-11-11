import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { can, type Permission } from '@seatbook/shared';
import { app } from './setup/app';
import { eventInput, makeDraft, smallLayout } from './factories/events';
import { as } from './helpers/auth';
import { makeAdmin, makeAttendee, makeOrganizer } from './helpers/roles';
import { OrganizerApplication } from '../src/db/models';

type Who = 'guest' | 'attendee' | 'organizer' | 'admin';
type Fixture = { applicationId: string; userId: string; eventId: string };
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
  {
    name: 'create event',
    method: 'post',
    path: () => '/api/organizer/events',
    perm: 'event:create',
    body: () => eventInput(),
  },
  {
    name: 'list my events',
    method: 'get',
    path: () => '/api/organizer/events',
    perm: 'event:manage',
  },
  {
    name: 'read owned event',
    method: 'get',
    path: (f) => `/api/organizer/events/${f.eventId}`,
    perm: 'event:manage',
  },
  {
    name: 'update owned event',
    method: 'patch',
    path: (f) => `/api/organizer/events/${f.eventId}`,
    perm: 'event:manage',
    body: () => ({ title: 'Renamed event', expectedRevision: 1 }),
  },
  {
    name: 'delete owned event',
    method: 'delete',
    path: (f) => `/api/organizer/events/${f.eventId}`,
    perm: 'event:manage',
  },
  {
    name: 'admin list events',
    method: 'get',
    path: () => '/api/admin/events',
    perm: 'admin:events',
  },
  {
    name: 'save seat map',
    method: 'put',
    path: (f) => `/api/organizer/events/${f.eventId}/seat-map`,
    perm: 'event:manage',
    body: () => ({ ...smallLayout(), expectedRevision: 1 }),
  },
  {
    name: 'publish',
    method: 'post',
    path: (f) => `/api/organizer/events/${f.eventId}/publish`,
    perm: 'event:manage',
  },
  {
    name: 'unpublish',
    method: 'post',
    path: (f) => `/api/organizer/events/${f.eventId}/unpublish`,
    perm: 'event:manage',
  },
  {
    name: 'hold seat',
    method: 'post',
    path: (f) => `/api/events/${f.eventId}/hold/seats`,
    perm: 'seat:hold',
    body: () => ({ seatId: '000000000000000000000001' }),
  },
  {
    name: 'release seat',
    method: 'delete',
    path: (f) => `/api/events/${f.eventId}/hold/seats/000000000000000000000001`,
    perm: 'seat:hold',
  },
  {
    name: 'my hold',
    method: 'get',
    path: (f) => `/api/events/${f.eventId}/hold`,
    perm: 'seat:hold',
  },
  {
    name: 'release all',
    method: 'delete',
    path: (f) => `/api/events/${f.eventId}/hold`,
    perm: 'seat:hold',
  },
  {
    name: 'checkout',
    method: 'post',
    path: (f) => `/api/events/${f.eventId}/hold/checkout`,
    perm: 'booking:create',
    body: () => ({ paymentToken: 'tok_visa' }),
  },
  { name: 'my bookings', method: 'get', path: () => '/api/me/bookings', perm: 'booking:viewOwn' },
  {
    name: 'one booking',
    method: 'get',
    path: () => '/api/me/bookings/000000000000000000000001',
    perm: 'booking:viewOwn',
  },
  { name: 'my tickets', method: 'get', path: () => '/api/me/tickets', perm: 'ticket:viewOwn' },
  {
    name: 'one ticket',
    method: 'get',
    path: () => '/api/me/tickets/000000000000000000000001',
    perm: 'ticket:viewOwn',
  },
  {
    name: 'check in',
    method: 'post',
    path: (f) => `/api/organizer/events/${f.eventId}/check-in`,
    perm: 'checkin:perform',
    body: () => ({ code: 'x', method: 'qr' }),
  },
  {
    name: 'scan log',
    method: 'get',
    path: (f) => `/api/organizer/events/${f.eventId}/scans`,
    perm: 'checkin:perform',
  },
  {
    name: 'organizer overview',
    method: 'get',
    path: () => '/api/organizer/overview',
    perm: 'dashboard:view',
  },
  {
    name: 'event dashboard',
    method: 'get',
    path: (f) => `/api/organizer/events/${f.eventId}/dashboard`,
    perm: 'dashboard:view',
  },
  {
    name: 'attendee list',
    method: 'get',
    path: (f) => `/api/organizer/events/${f.eventId}/attendees`,
    perm: 'attendees:view',
  },
  {
    name: 'admin overview',
    method: 'get',
    path: () => '/api/admin/overview',
    perm: 'admin:overview',
  },
  {
    name: 'admin event dashboard',
    method: 'get',
    path: (f) => `/api/admin/events/${f.eventId}/dashboard`,
    perm: 'admin:events',
  },
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
    const event = await makeDraft(tokens.organizer); // an admin is "allowed" here but gets a 404: not theirs
    fixture = { applicationId: String(a._id), userId: victim.user.id, eventId: event.id };
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
