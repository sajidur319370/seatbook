import { Event } from '../../src/db/models';
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

/** Publish goes straight to the DB until Day 7 adds the real endpoint. */
export async function makePublished(token: string, over: Record<string, unknown> = {}) {
  const event = await makeDraft(token, over);
  await Event.updateOne(
    { _id: event.id },
    { $set: { status: 'published', publishedAt: new Date() } },
  );
  return event;
}
