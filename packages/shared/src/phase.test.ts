import { describe, expect, it } from 'vitest';
import { eventPhase } from './phase';

const ev = {
  status: 'published' as const,
  salesStartAt: new Date('2026-11-01T00:00:00Z'),
  salesEndAt: new Date('2026-11-14T13:30:00Z'),
  startsAt: new Date('2026-11-14T13:30:00Z'),
  endsAt: new Date('2026-11-14T16:30:00Z'),
};
const at = (iso: string) => new Date(iso);

describe('eventPhase', () => {
  it.each([
    ['2026-10-31T23:59:59Z', 'scheduled'],
    ['2026-11-01T00:00:00Z', 'on_sale'], // boundary: sales start is inclusive
    ['2026-11-14T13:29:59Z', 'on_sale'],
    ['2026-11-14T13:30:00Z', 'sales_closed'], // boundary: sales end is exclusive
    ['2026-11-14T16:29:59Z', 'sales_closed'],
    ['2026-11-14T16:30:00Z', 'ended'],
  ])('%s → %s', (now, phase) => expect(eventPhase(ev, at(now))).toBe(phase));

  it('draft and cancelled ignore the clock', () => {
    expect(eventPhase({ ...ev, status: 'draft' }, at('2026-11-05T00:00:00Z'))).toBe('draft');
    expect(eventPhase({ ...ev, status: 'cancelled' }, at('2026-11-05T00:00:00Z'))).toBe(
      'cancelled',
    );
  });

  it('a missing sales end falls back to the start time', () => {
    const open = { ...ev, salesEndAt: null };
    expect(eventPhase(open, at('2026-11-14T13:29:59Z'))).toBe('on_sale');
    expect(eventPhase(open, at('2026-11-14T13:30:00Z'))).toBe('sales_closed');
  });

  it('accepts ISO strings as well as dates', () => {
    const fromJson = {
      ...ev,
      salesStartAt: ev.salesStartAt.toISOString(),
      salesEndAt: ev.salesEndAt.toISOString(),
      startsAt: ev.startsAt.toISOString(),
      endsAt: ev.endsAt.toISOString(),
    };
    expect(eventPhase(fromJson, at('2026-11-05T00:00:00Z'))).toBe('on_sale');
  });
});
