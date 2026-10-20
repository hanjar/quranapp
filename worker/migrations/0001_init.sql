-- Mushaf Digital sync API - initial schema.
-- All per-user rows carry `rev`, a monotonic per-user revision taken from user_revisions.
-- Server-generated timestamps are INTEGER epoch milliseconds. Client-supplied createdAt/updatedAt
-- (epoch ms) are informational only and are never used for ordering.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('google', 'dev')),
  auth_subject  TEXT NOT NULL,
  email         TEXT,
  name          TEXT,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  UNIQUE (auth_provider, auth_subject)
);

-- id = hex(sha256(random token)); the raw token only ever lives in the cookie.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  return_to     TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

-- revision: last allocated revision for the user.
-- tombstone_horizon: highest rev of any tombstone that retention cleanup has purged.
-- A cursor below it can no longer be served incrementally -> sync answers reset:true.
CREATE TABLE user_revisions (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision          INTEGER NOT NULL DEFAULT 0,
  tombstone_horizon INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bookmarks (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semantic_key TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('verse', 'page')),
  edition_id   TEXT NOT NULL,
  page         INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
  surah        INTEGER CHECK (surah IS NULL OR surah BETWEEN 1 AND 114),
  ayah         INTEGER CHECK (ayah IS NULL OR ayah BETWEEN 1 AND 286),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  rev          INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- At most one ACTIVE bookmark per semantic target; tombstones are exempt.
CREATE UNIQUE INDEX uq_bookmarks_active_key
  ON bookmarks(user_id, semantic_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmarks_rev ON bookmarks(user_id, rev);
CREATE INDEX idx_bookmarks_tombstones ON bookmarks(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE reading_progress (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL,
  page       INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
  surah      INTEGER CHECK (surah IS NULL OR surah BETWEEN 1 AND 114),
  ayah       INTEGER CHECK (ayah IS NULL OR ayah BETWEEN 1 AND 286),
  updated_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, edition_id)
);
CREATE INDEX idx_progress_rev ON reading_progress(user_id, rev);

CREATE TABLE preferences (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL
);

-- Idempotency: the stored result of every processed operation, replayed on retry.
CREATE TABLE op_log (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op_id       TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, op_id)
);
CREATE INDEX idx_op_log_created ON op_log(created_at);

CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
