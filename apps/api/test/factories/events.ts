import { newId, type SeatMapInput } from '@seatbook/shared';
import { Event, Seat } from '../../src/db/models';
import { addDays } from '../../src/lib/dates';
import { as } from '../helpers/auth';

export const eventInput = (over: Record<string, unknown> = {}) => ({
  title: 'Hamlet — Evening Show',
  venue: { name: 'Shilpakala Main Hall', city: 'Dhaka' },
  timezone: 'Asia/Dhaka',
  startsAt: addDays(new Date(), 20).toISOString(),
  endsAt: new Date(addDays(new Date(), 20).getTime() + 3 * 3_600_000).toISOString(),
  currency: 'BDT',
  ...over,
});

export async function makeDraft(token: string, over: Record<string, unknown> = {}) {
  const res = await as(token).post('/api/organizer/events').send(eventInput(over));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.event as { id: string; slug: string; revision: number };
}

/**
 * Only flips the status, with no layout or seats. For listing tests, including past events the
 * real publish endpoint would refuse. Use makePublishedEvent for everything else.
 */
export async function makePublished(token: string, over: Record<string, unknown> = {}) {
  const event = await makeDraft(token, over);
  await Event.updateOne(
    { _id: event.id },
    { $set: { status: 'published', publishedAt: new Date() } },
  );
  return event;
}

/** 2 sections × 3 rows × 5 seats = 30 seats, one tier. On sale immediately. */
export function smallLayout() {
  const tier = { _id: newId(), name: 'Standard', price: 4000, color: 'teal' as const };
  const section = (code: string, x: number) => ({
    _id: newId(),
    name: code,
    code,
    x,
    y: 0,
    numbering: 'ltr' as const,
    rows: ['A', 'B', 'C'].map((label) => ({
      label,
      seats: 5,
      offset: 0,
      tierId: tier._id,
      gapsAfter: [],
      blocked: [],
    })),
  });
  return { stageLabel: 'STAGE', tiers: [tier], sections: [section('L', 0), section('R', 10)] };
}

type Layout = Omit<SeatMapInput, 'expectedRevision'>;

export async function makePublishedEvent(
  token: string,
  over: Record<string, unknown> = {},
  layout: Layout = smallLayout(),
) {
  const draft = await makeDraft(token, over);
  const saved = await as(token)
    .put(`/api/organizer/events/${draft.id}/seat-map`)
    .send({ ...layout, expectedRevision: draft.revision });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved.body));
  const pub = await as(token).post(`/api/organizer/events/${draft.id}/publish`);
  if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
  const seats = await Seat.find({ eventId: draft.id }).sort({ label: 1 }).lean();
  return {
    event: pub.body.event,
    eventId: draft.id,
    seats: seats.map((s) => ({ id: String(s._id), label: s.label })),
  };
}
