import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Event } from '../src/db/models';
import { organizerRouter } from '../src/modules/organizer/organizer.routes';
import { as } from './helpers/auth';
import { makeAdmin, makeOrganizer } from './helpers/roles';
import { makeDraft } from './factories/events';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

/** Every route of the organizer router that has :eventId in its path. */
function eventRoutes() {
  return (organizerRouter as unknown as { stack: Layer[] }).stack
    .filter((l) => l.route?.path.includes(':eventId'))
    .flatMap((l) =>
      Object.keys(l.route!.methods).map((m) => ({
        method: m as 'get' | 'post' | 'patch' | 'put' | 'delete',
        path: l.route!.path,
      })),
    );
}

describe('cross-owner isolation', () => {
  let a: Awaited<ReturnType<typeof makeOrganizer>>;
  let b: Awaited<ReturnType<typeof makeOrganizer>>;
  let eventOfA: string;

  beforeEach(async () => {
    a = await makeOrganizer('Organizer A');
    b = await makeOrganizer('Organizer B');
    eventOfA = (await makeDraft(a.token)).id;
  });

  it('finds the routes to test', () => {
    expect(eventRoutes().length).toBeGreaterThanOrEqual(3); // grows every day
  });

  for (const r of eventRoutes()) {
    it(`${r.method.toUpperCase()} /organizer${r.path} → 404 for another organizer`, async () => {
      const url = (id: string) =>
        `/api/organizer${r.path.replace(':eventId', id).replace(/:\w+/g, new Types.ObjectId().toHexString())}`;
      const foreign = await as(b.token)[r.method](url(eventOfA)).send({});
      const random = await as(b.token)[r.method](url(new Types.ObjectId().toHexString())).send({});

      expect(foreign.status).toBe(404);
      // Identical to a non-existent id (NFR-SEC-02): same code and message.
      expect({ ...foreign.body.error, requestId: 0 }).toEqual({
        ...random.body.error,
        requestId: 0,
      });
    });

    it(`${r.method.toUpperCase()} /organizer${r.path} → admins get no bypass (FR-RBAC-04)`, async () => {
      const admin = await makeAdmin();
      const url = `/api/organizer${r.path.replace(':eventId', eventOfA).replace(/:\w+/g, new Types.ObjectId().toHexString())}`;
      expect((await as(admin.token)[r.method](url).send({})).status).toBe(404);
    });
  }

  it("another organizer's write changes nothing", async () => {
    const url = `/api/organizer/events/${eventOfA}`;
    await as(b.token).patch(url).send({ title: 'Hijacked', expectedRevision: 1 });
    await as(b.token).delete(url);
    const stored = await Event.findOne({ _id: eventOfA }).lean();
    expect(stored?.title).toBe('Hamlet — Evening Show');
    expect(stored?.revision).toBe(1);
  });

  it('a malformed id → 400, not a server error', async () => {
    const res = await as(b.token).get('/api/organizer/events/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('the owner can read it', async () => {
    expect((await as(a.token).get(`/api/organizer/events/${eventOfA}`)).status).toBe(200);
  });

  it('a list never includes another organizer’s events', async () => {
    const mine = await as(b.token).get('/api/organizer/events');
    expect(mine.body.items).toEqual([]);
  });

  it("a draft isn't public, not even by slug", async () => {
    const draft = await makeDraft(a.token);
    expect((await as(b.token).get(`/api/events/${draft.slug}`)).status).toBe(404);
    expect((await as(a.token).get(`/api/events/${draft.slug}`)).status).toBe(200); // owner preview
  });
});
