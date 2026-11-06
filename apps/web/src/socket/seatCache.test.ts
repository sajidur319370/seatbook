import { describe, expect, it } from 'vitest';
import type { SeatCell, SeatMapResponse } from '@seatbook/shared';
import { applySeatChanges, expireLocally, keepNewerSeats } from './seatCache';

const cell = (id: string, over: Partial<SeatCell> = {}): SeatCell => ({
  id,
  s: 0,
  r: 'A',
  n: 1,
  x: 0,
  y: 0,
  t: 0,
  st: 'available',
  v: 5,
  ...over,
});
const mapOf = (...seats: SeatCell[]) => ({ seats }) as unknown as SeatMapResponse;
const change = (seatId: string, version: number, status: SeatCell['st'] = 'held') => ({
  seatId,
  status,
  version,
  holdExpiresAt: status === 'held' ? '2030-01-01T00:00:00.000Z' : null,
});

describe('applySeatChanges', () => {
  it('applies a newer version', () => {
    const next = applySeatChanges(mapOf(cell('a')), [change('a', 6)]);
    expect(next.seats[0]).toMatchObject({ st: 'held', v: 6, exp: '2030-01-01T00:00:00.000Z' });
  });

  it.each([
    ['the same version', 5],
    ['an older version', 4],
  ])('ignores %s, returning the same object', (_name, version) => {
    const map = mapOf(cell('a'));
    expect(applySeatChanges(map, [change('a', version)])).toBe(map);
  });

  it('ignores a seat it doesn’t know', () => {
    const map = mapOf(cell('a'));
    expect(applySeatChanges(map, [change('zz', 9)])).toBe(map);
  });

  it('a late message can’t undo a newer one, in either order', () => {
    const held = change('a', 6);
    const freed = change('a', 7, 'available');
    const once = applySeatChanges(applySeatChanges(mapOf(cell('a')), [held]), [freed]);
    const swapped = applySeatChanges(applySeatChanges(mapOf(cell('a')), [freed]), [held]);
    expect(once.seats[0]).toMatchObject({ st: 'available', v: 7 });
    expect(swapped.seats[0]).toMatchObject({ st: 'available', v: 7 });
  });

  it('clears the expiry when a seat is freed', () => {
    const next = applySeatChanges(mapOf(cell('a', { st: 'held', exp: 'x' })), [
      change('a', 6, 'available'),
    ]);
    expect(next.seats[0]!.exp).toBeUndefined();
  });

  it('a batch of 3 with 1 stale replaces 2 cells; every other cell is the same object', () => {
    const seats = Array.from({ length: 5000 }, (_, i) => cell(`s${i}`));
    const map = mapOf(...seats);
    const next = applySeatChanges(map, [change('s1', 6), change('s2', 5), change('s3', 6)]);
    const replaced = next.seats.filter((c, i) => c !== seats[i]);
    expect(replaced.map((c) => c.id)).toEqual(['s1', 's3']);
  });
});

describe('expireLocally', () => {
  const past = '2020-01-01T00:00:00.000Z';
  const future = '2040-01-01T00:00:00.000Z';
  const now = Date.parse('2030-01-01T00:00:00.000Z');

  it('frees a held seat whose time has passed, keeping its version', () => {
    const next = expireLocally(mapOf(cell('a', { st: 'held', exp: past })), now, new Set());
    expect(next.seats[0]).toMatchObject({ st: 'available', v: 5 });
    expect(next.seats[0]!.exp).toBeUndefined();
  });

  it('the server’s confirmation still applies afterwards', () => {
    const local = expireLocally(mapOf(cell('a', { st: 'held', exp: past })), now, new Set());
    expect(applySeatChanges(local, [change('a', 6, 'available')]).seats[0]!.v).toBe(6);
  });

  it.each([
    ['a seat with time left', cell('a', { st: 'held', exp: future })],
    ['a held seat with no time known', cell('a', { st: 'held' })],
    ['a sold seat', cell('a', { st: 'booked', exp: past })],
  ])('leaves %s alone, returning the same object', (_name, seat) => {
    const map = mapOf(seat);
    expect(expireLocally(map, now, new Set())).toBe(map);
  });

  it('skips my own seats: my countdown deals with those', () => {
    const map = mapOf(cell('a', { st: 'held', exp: past }));
    expect(expireLocally(map, now, new Set(['a']))).toBe(map);
  });
});

describe('keepNewerSeats', () => {
  it('a slow answer can’t undo a newer message', () => {
    const cached = mapOf(cell('a', { st: 'held', v: 6 }), cell('b'));
    const fresh = mapOf(cell('a', { v: 5 }), cell('b', { st: 'booked', v: 7 }));
    const next = keepNewerSeats(fresh, cached);
    expect(next.seats[0]).toMatchObject({ st: 'held', v: 6 });
    expect(next.seats[1]).toMatchObject({ st: 'booked', v: 7 });
  });

  it('takes the fresh answer when the versions match: local expiry may have guessed', () => {
    const cached = mapOf(cell('a', { st: 'available', v: 5 }));
    const fresh = mapOf(cell('a', { st: 'held', v: 5 }));
    expect(keepNewerSeats(fresh, cached)).toBe(fresh);
  });

  it('with nothing cached, or nothing newer, it returns the fresh answer itself', () => {
    const fresh = mapOf(cell('a'));
    expect(keepNewerSeats(fresh, undefined)).toBe(fresh);
    expect(keepNewerSeats(fresh, mapOf(cell('a', { v: 2 })))).toBe(fresh);
  });
});
