import { describe, expect, it } from 'vitest';
import type { EventDashboardDto } from '@seatbook/shared';
import { applyCheckin, applySales, fillBuckets, withDerived } from './kpi';

const kpi: EventDashboardDto['kpi'] = {
  sold: 11,
  sellable: 15,
  soldPct: 0.7333,
  revenue: 60_000,
  avgTicketPrice: 5_455,
  checkedIn: 7,
  checkinRate: 0.6364,
  heldNow: 0,
  duplicateScans: 2,
};

describe('live KPI patches', () => {
  it('derive the ratios exactly like the server (the fixture numbers)', () => {
    expect(withDerived({ ...kpi, soldPct: 0, avgTicketPrice: 0, checkinRate: 0 })).toEqual(kpi);
  });

  it('a sale moves sold, revenue and every ratio at once', () => {
    const k = applySales(kpi, { seatsSold: 12, revenue: 65_000 });
    expect(k).toMatchObject({ sold: 12, revenue: 65_000, soldPct: 0.8, avgTicketPrice: 5_417 });
    expect(k.checkinRate).toBe(0.5833); // 7 / 12
  });

  it('a duplicate scan counts once; an older count never moves checked-in backwards', () => {
    const k = applyCheckin(kpi, {
      result: 'already_checked_in',
      counts: { checkedIn: 6, sold: 11 },
    });
    expect(k.duplicateScans).toBe(3);
    expect(k.checkedIn).toBe(7);
    const ok = applyCheckin(kpi, { result: 'ok', counts: { checkedIn: 8, sold: 11 } });
    expect(ok).toMatchObject({ checkedIn: 8, duplicateScans: 2, checkinRate: 0.7273 });
  });

  it('no sales: zeros, never NaN', () => {
    expect(withDerived({ ...kpi, sold: 0, sellable: 0, revenue: 0, checkedIn: 0 })).toMatchObject({
      soldPct: 0,
      avgTicketPrice: 0,
      checkinRate: 0,
    });
  });
});

describe('fillBuckets', () => {
  it('fills the 5-minute gaps between the first and last bucket with zeros', () => {
    const out = fillBuckets([
      { at: '2030-06-14T15:00:00.000Z', n: 2 },
      { at: '2030-06-14T15:20:00.000Z', n: 1 },
    ]);
    expect(out.map((r) => [r.at.slice(11, 16), r.n])).toEqual([
      ['15:00', 2],
      ['15:05', 0],
      ['15:10', 0],
      ['15:15', 0],
      ['15:20', 1],
    ]);
  });

  it('nothing in, nothing out', () => {
    expect(fillBuckets([])).toEqual([]);
  });
});
