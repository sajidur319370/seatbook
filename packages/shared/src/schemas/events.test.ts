import { describe, expect, it } from 'vitest';
import { createEventSchema, scheduleIssues, updateEventSchema } from './events';

const at = (hours: number) => new Date(Date.UTC(2030, 0, 1, hours));
const paths = (s: Parameters<typeof scheduleIssues>[0]) => scheduleIssues(s).map((i) => i.path[0]);

describe('scheduleIssues', () => {
  it('accepts a normal schedule, with or without a sales window', () => {
    expect(scheduleIssues({ startsAt: at(10), endsAt: at(12) })).toEqual([]);
    expect(
      scheduleIssues({ startsAt: at(10), endsAt: at(12), salesStartAt: at(1), salesEndAt: at(11) }),
    ).toEqual([]);
  });

  it('an end before the start blames only the end, not a sales date nobody set', () => {
    expect(paths({ startsAt: at(10), endsAt: at(8) })).toEqual(['endsAt']);
  });

  it('flags an event over 24 hours', () => {
    expect(paths({ startsAt: at(0), endsAt: new Date(at(0).getTime() + 25 * 3_600_000) })).toEqual([
      'endsAt',
    ]);
  });

  it('flags a chosen sales end after the event, and a sales start after the sales end', () => {
    expect(paths({ startsAt: at(10), endsAt: at(12), salesEndAt: at(13) })).toEqual(['salesEndAt']);
    expect(
      paths({ startsAt: at(10), endsAt: at(12), salesStartAt: at(9), salesEndAt: at(8) }),
    ).toEqual(['salesStartAt']);
  });
});

describe('updateEventSchema', () => {
  it('keeps only what was sent: no defaults sneak in', () => {
    expect(updateEventSchema.parse({ title: 'New title', expectedRevision: 1 })).toEqual({
      title: 'New title',
      expectedRevision: 1,
    });
  });
});

describe('createEventSchema', () => {
  const base = {
    title: 'Hamlet',
    venue: { name: 'Hall', city: 'Dhaka' },
    timezone: 'UTC',
    startsAt: '2030-01-01T10:00:00Z',
    endsAt: '2030-01-01T12:00:00Z',
  };

  it('fills the defaults', () => {
    expect(createEventSchema.parse(base)).toMatchObject({
      summary: '',
      category: 'other',
      currency: 'USD',
      maxSeatsPerOrder: 8,
      coverColor: 'indigo',
      refundsAllowed: false,
    });
  });

  it('a bad date is a validation error, not a crash', () => {
    expect(createEventSchema.safeParse({ ...base, startsAt: 'nope' }).success).toBe(false);
  });
});
