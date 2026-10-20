import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './async';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('passes through rejections', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 50)).rejects.toThrow('x');
  });

  it('rejects with TimeoutError when the promise hangs', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<never>(() => undefined), 100);
    vi.advanceTimersByTime(101);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    vi.useRealTimers();
  });
});
