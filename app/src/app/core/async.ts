/** Rejected by withTimeout when the wrapped promise did not settle in time. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Tidak selesai dalam ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Settles with `p`, or rejects with TimeoutError after `ms`. Used for local
 * writes so the UI always gives feedback, even if IndexedDB is stuck (e.g. a
 * blocked open on a device with stale tabs) instead of silently doing nothing.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Feedback budget for a local bookmark write. */
export const LOCAL_WRITE_TIMEOUT_MS = 5000;
