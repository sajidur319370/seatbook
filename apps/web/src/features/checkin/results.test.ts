import { describe, expect, it } from 'vitest';
import { SCAN_RESULTS, type CheckinTicketDto } from '@seatbook/shared';
import { describeResult, mergeCounts } from './results';

const ticket: CheckinTicketDto = {
  id: 't1',
  seatLabel: 'ORC-F7',
  sectionName: 'Orchestra',
  row: 'F',
  number: 7,
  tierName: 'Standard',
  holderName: 'Rafi Ahmed',
  checkedInAt: '2026-11-14T13:42:00.000Z', // 19:42 in Dhaka (UTC+6)
  checkedInByName: 'Nadia',
  checkedInGate: 'Gate 2',
};

describe('describeResult', () => {
  it('welcomes with the seat, tier and name', () => {
    expect(describeResult({ result: 'ok', ticket }, 'Asia/Dhaka')).toEqual({
      tone: 'ok',
      title: 'Welcome',
      detail: 'ORC-F7 · Standard · Rafi Ahmed',
    });
  });

  it('says when, by whom and where a ticket was already used, in the event’s time', () => {
    const d = describeResult({ result: 'already_checked_in', ticket }, 'Asia/Dhaka');
    expect(d.tone).toBe('bad');
    expect(d.title).toBe('Already used');
    expect(d.detail).toContain('at 19:42 by Nadia (Gate 2)');
  });

  it('has a word and a tone for every result', () => {
    for (const result of SCAN_RESULTS) {
      const d = describeResult({ result, ticket: null }, 'UTC');
      expect(d.title.length).toBeGreaterThan(0);
      expect(['ok', 'warn', 'bad']).toContain(d.tone);
    }
  });

  it('only "ok" is green', () => {
    const green = SCAN_RESULTS.filter(
      (r) => describeResult({ result: r, ticket: null }, 'UTC').tone === 'ok',
    );
    expect(green).toEqual(['ok']);
  });
});

describe('mergeCounts', () => {
  it('never lets the checked-in count go backwards', () => {
    const a = mergeCounts(null, { checkedIn: 5, sold: 10 });
    expect(mergeCounts(a, { checkedIn: 4, sold: 11 })).toEqual({ checkedIn: 5, sold: 11 });
    expect(mergeCounts(a, { checkedIn: 6, sold: 10 })).toEqual({ checkedIn: 6, sold: 10 });
  });
});
