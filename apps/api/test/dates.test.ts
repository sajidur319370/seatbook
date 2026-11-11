import { describe, expect, it } from 'vitest';
import type { DayRow } from '@seatbook/shared';
import { calendarDays, dayIn, fillCounts, fillDays } from '../src/lib/dates';

const row = (day: string, tickets: number, cumTickets: number): DayRow => ({
  day,
  tickets,
  revenue: tickets * 100,
  cumTickets,
  cumRevenue: cumTickets * 100,
});

describe('day helpers (TR-01: dashboard day-filling)', () => {
  it('lists days inclusively, and nothing when from > to', () => {
    expect(calendarDays('2030-06-10', '2030-06-12')).toEqual([
      '2030-06-10',
      '2030-06-11',
      '2030-06-12',
    ]);
    expect(calendarDays('2030-06-12', '2030-06-10')).toEqual([]);
    expect(calendarDays('2030-06-10', '2030-06-10')).toEqual(['2030-06-10']);
  });

  it('crosses the US DST change without skipping or repeating a day', () => {
    expect(calendarDays('2030-03-09', '2030-03-11')).toEqual([
      '2030-03-09',
      '2030-03-10',
      '2030-03-11',
    ]);
    expect(calendarDays('2030-11-02', '2030-11-04')).toHaveLength(3); // and back
  });

  it('crosses month and leap-year ends', () => {
    expect(calendarDays('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it("names the day as the event's city sees it", () => {
    const i = new Date('2030-06-11T03:30:00Z');
    expect(dayIn(i, 'America/New_York')).toBe('2030-06-10'); // 23:30 the evening before
    expect(dayIn(i, 'Asia/Dhaka')).toBe('2030-06-11'); // 09:30 that morning
    expect(dayIn(i, 'UTC')).toBe('2030-06-11');
  });

  it('fills a gap with zero sales and the PREVIOUS running totals', () => {
    const out = fillDays(
      [row('2030-06-10', 5, 5), row('2030-06-12', 2, 7)],
      '2030-06-10',
      '2030-06-12',
    );
    expect(out[1]).toEqual({
      day: '2030-06-11',
      tickets: 0,
      revenue: 0,
      cumTickets: 5,
      cumRevenue: 500,
    });
    expect(out.map((r) => r.cumTickets)).toEqual([5, 5, 7]);
  });

  it('a gap at the start carries zero', () => {
    const out = fillDays([row('2030-06-12', 2, 2)], '2030-06-10', '2030-06-12');
    expect(out.map((r) => [r.tickets, r.cumTickets])).toEqual([
      [0, 0],
      [0, 0],
      [2, 2],
    ]);
  });

  it('a row outside the range is ignored instead of shifting the others', () => {
    const out = fillDays(
      [row('2030-06-09', 9, 9), row('2030-06-10', 1, 10)],
      '2030-06-10',
      '2030-06-11',
    );
    expect(out.map((r) => r.tickets)).toEqual([1, 0]);
  });

  it('fillCounts zero-fills plain counts', () => {
    expect(fillCounts([{ day: '2030-06-11', tickets: 4 }], '2030-06-10', '2030-06-12')).toEqual([
      { day: '2030-06-10', tickets: 0 },
      { day: '2030-06-11', tickets: 4 },
      { day: '2030-06-12', tickets: 0 },
    ]);
  });
});
