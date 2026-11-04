import { describe, expect, it } from 'vitest';
import { formatMoney, toMinor } from './money';

describe('toMinor', () => {
  it.each([
    ['75', 7500],
    ['75.5', 7550],
    ['19.99', 1999],
    ['0.07', 7], // a float-based version gives 7.000000000000001
    [' 1.10 ', 110],
    [40, 4000],
  ])('%s → %s', (major, minor) => expect(toMinor(major)).toBe(minor));

  it.each(['1.234', '-1', 'abc', '', '1,000', '1.'])('rejects %j', (bad) => {
    expect(toMinor(bad)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats minor units in the event currency', () => {
    expect(formatMoney(7500, 'USD')).toBe('$75.00');
    expect(formatMoney(120000, 'BDT')).toContain('1,200.00');
  });
});
