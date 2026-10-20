export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 5 * 60 * 1000;

/** Upper bound of the jitter window for the n-th failed attempt (n >= 1). */
export function backoffCeiling(attempt: number): number {
  const n = Math.max(1, Math.trunc(attempt));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/**
 * Exponential backoff with full jitter: uniform in [0, ceiling). A server
 * Retry-After acts as a floor.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
  retryAfterMs: number | null = null,
): number {
  const jittered = Math.floor(random() * backoffCeiling(attempt));
  return retryAfterMs != null ? Math.max(jittered, retryAfterMs) : jittered;
}

/** Parses a Retry-After header (delta seconds or HTTP date) into ms. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
