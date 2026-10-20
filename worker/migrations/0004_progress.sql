-- Phase 3: automatic reading progress (reading day log + khatam rounds).

-- One row per user per device-local calendar day. `pages` is JSON {"<page>": [firstAt, lastAt]}.
-- Rows are grow-only (merged by union on write); only "clear history" tombstones them.
-- `cleared_at` records the clear watermark in force when the row was tombstoned.
CREATE TABLE reading_days (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL CHECK (length(day) = 10),
  pages      TEXT NOT NULL CHECK (json_valid(pages)),
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  cleared_at INTEGER,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX idx_reading_days_rev ON reading_days(user_id, rev);
CREATE INDEX idx_reading_days_tombstones ON reading_days(deleted_at) WHERE deleted_at IS NOT NULL;

-- Khatam rounds: last-writer-wins per round; the round number is unique among live rounds.
CREATE TABLE khatam_rounds (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  n           INTEGER NOT NULL CHECK (n >= 1),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX uq_khatam_active_n ON khatam_rounds(user_id, n) WHERE deleted_at IS NULL;
CREATE INDEX idx_khatam_rev ON khatam_rounds(user_id, rev);
CREATE INDEX idx_khatam_tombstones ON khatam_rounds(deleted_at) WHERE deleted_at IS NOT NULL;

-- Server time (ms) of the last "Hapus riwayat baca". Reads at/before it and rounds started
-- at/before it are ignored on upload, so a stale device cannot resurrect cleared history.
ALTER TABLE user_revisions ADD COLUMN progress_cleared_at INTEGER NOT NULL DEFAULT 0;
