import { describe, expect, it } from 'vitest';
import { ROW_LABEL } from '../constants';
import { rowIndex, rowLabel, rowRange } from './rowLabels';

describe('row labels', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [49, 'AX'],
    [52, 'BA'],
    [701, 'ZZ'],
  ])('%i ↔ %s', (i, label) => {
    expect(rowLabel(i)).toBe(label);
    expect(rowIndex(label)).toBe(i);
  });

  it('round-trips every label, and each one is valid', () => {
    for (let i = 0; i <= 701; i++) {
      expect(rowIndex(rowLabel(i))).toBe(i);
      expect(rowLabel(i)).toMatch(ROW_LABEL);
    }
  });

  it('ranges are inclusive and can cross into two letters', () => {
    expect(rowRange('A', 'C')).toEqual(['A', 'B', 'C']);
    expect(rowRange('Y', 'AB')).toEqual(['Y', 'Z', 'AA', 'AB']);
    expect(rowRange('BA', 'BB')).toEqual(['BA', 'BB']);
  });

  it('a backwards range is empty', () => {
    expect(rowRange('C', 'A')).toEqual([]);
  });
});
