import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, backoffCeiling, backoffDelay, parseRetryAfter } from './backoff';

describe('backoff', () => {
  it('doubles the jitter ceiling from 2 s and caps at 5 min', () => {
    expect(backoffCeiling(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffCeiling(2)).toBe(4000);
    expect(backoffCeiling(3)).toBe(8000);
    expect(backoffCeiling(20)).toBe(BACKOFF_CAP_MS);
    expect(backoffCeiling(0)).toBe(BACKOFF_BASE_MS);
  });

  it('applies full jitter in [0, ceiling)', () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(4000);
    expect(backoffDelay(3, () => 0.999999)).toBeLessThan(8000);
  });

  it('uses Retry-After as a floor', () => {
    expect(backoffDelay(1, () => 0.1, 30_000)).toBe(30_000);
    expect(backoffDelay(10, () => 0.9, 1000)).toBeGreaterThan(1000);
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('nonsense')).toBeNull();
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
  });
});
