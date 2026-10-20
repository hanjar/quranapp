import { describe, expect, it } from 'vitest';
import { isNightAt, nextBoundary, parseHHMM } from './night-schedule';

const at = (h: number, m = 0, day = 15) => new Date(2026, 9, day, h, m, 0, 0);

describe('night schedule', () => {
  it('parses HH:MM', () => {
    expect(parseHHMM('05:30')).toBe(330);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('5:00')).toBeNull();
  });

  it('crosses midnight (18:00 -> 05:00)', () => {
    expect(isNightAt(at(17, 59), '18:00', '05:00')).toBe(false);
    expect(isNightAt(at(18, 0), '18:00', '05:00')).toBe(true);
    expect(isNightAt(at(23, 59), '18:00', '05:00')).toBe(true);
    expect(isNightAt(at(0, 0), '18:00', '05:00')).toBe(true);
    expect(isNightAt(at(4, 59), '18:00', '05:00')).toBe(true);
    expect(isNightAt(at(5, 0), '18:00', '05:00')).toBe(false);
    expect(isNightAt(at(12), '18:00', '05:00')).toBe(false);
  });

  it('handles same-day windows and equal/invalid times', () => {
    expect(isNightAt(at(13), '12:00', '14:00')).toBe(true);
    expect(isNightAt(at(14), '12:00', '14:00')).toBe(false);
    expect(isNightAt(at(3), '06:00', '06:00')).toBe(false);
    expect(isNightAt(at(3), 'xx', '06:00')).toBe(false);
  });

  it('finds the next boundary', () => {
    expect(nextBoundary(at(12), '18:00', '05:00')).toEqual(at(18));
    expect(nextBoundary(at(19), '18:00', '05:00')).toEqual(at(5, 0, 16));
    expect(nextBoundary(at(2), '18:00', '05:00')).toEqual(at(5));
    expect(nextBoundary(at(18, 0), '18:00', '05:00')).toEqual(at(5, 0, 16));
    expect(nextBoundary(at(5), '06:00', '06:00')).toBeNull();
  });
});
