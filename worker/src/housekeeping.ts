/** Retention policy (documented in docs/worker.md). */
export const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const OP_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;

export interface RateResult {
  allowed: boolean;
  retryAfter: number; // seconds
}

/** Fixed-window counter in D1. One write per call. */
export async function rateLimit(db: D1Database, key: string, limit: number, now: number): Promise<RateResult> {
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000)) };
}

/**
 * Daily cleanup. Tombstones older than 180 days are purged, and the per-user
 * `tombstone_horizon` is raised to the highest purged rev so cursors older than that get reset:true.
 */
export async function runCleanup(db: D1Database, now: number): Promise<void> {
  const tombCutoff = now - TOMBSTONE_RETENTION_MS;
  await db.batch([
    db
      .prepare(
        `UPDATE user_revisions SET tombstone_horizon = MAX(tombstone_horizon, (
           SELECT MAX(b.rev) FROM bookmarks b
           WHERE b.user_id = user_revisions.user_id AND b.deleted_at IS NOT NULL AND b.deleted_at < ?1))
         WHERE EXISTS (
           SELECT 1 FROM bookmarks b
           WHERE b.user_id = user_revisions.user_id AND b.deleted_at IS NOT NULL AND b.deleted_at < ?1)`,
      )
      .bind(tombCutoff),
    db
      .prepare(
        `UPDATE user_revisions SET tombstone_horizon = MAX(tombstone_horizon, (
           SELECT MAX(f.rev) FROM folders f
           WHERE f.user_id = user_revisions.user_id AND f.deleted_at IS NOT NULL AND f.deleted_at < ?1))
         WHERE EXISTS (
           SELECT 1 FROM folders f
           WHERE f.user_id = user_revisions.user_id AND f.deleted_at IS NOT NULL AND f.deleted_at < ?1)`,
      )
      .bind(tombCutoff),
    db.prepare('DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?1').bind(tombCutoff),
    db.prepare('DELETE FROM bookmarks WHERE deleted_at IS NOT NULL AND deleted_at < ?1').bind(tombCutoff),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM oauth_states WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM op_log WHERE created_at < ?1').bind(now - OP_LOG_RETENTION_MS),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(now - 60 * 60 * 1000),
  ]);
}
