import { describe, expect, it } from 'vitest';
import { barPercents } from './bars';

describe('barPercents', () => {
  it('scales to the largest value', () => {
    expect(barPercents([100, 50, 25])).toEqual([100, 50, 25]);
  });

  it('keeps a tiny non-zero value visible', () => {
    expect(barPercents([1000, 1])[1]).toBe(2);
  });

  it('shows zero as zero, and an all-zero or empty set as nothing', () => {
    expect(barPercents([0, 0])).toEqual([0, 0]);
    expect(barPercents([])).toEqual([]);
    expect(barPercents([10, 0])).toEqual([100, 0]);
  });

  it('treats negative or non-finite values as zero', () => {
    expect(barPercents([10, -5, NaN])).toEqual([100, 0, 0]);
  });

  it('rounds to whole percentages', () => {
    expect(barPercents([3, 1])).toEqual([100, 33]);
  });
});
