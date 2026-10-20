-- Phase 3b: manual "already read" marks (pages read before tracking existed).
-- One row per user. `marks` is JSON {"<page>": [markedAt, unmarkedAt]}; writes merge per-component max
-- (grow-only), so devices never lose marks and an unmark survives a merge.
-- `cleared_at` records the clear watermark in force when "Hapus riwayat baca" last wiped the row.
CREATE TABLE read_marks (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marks      TEXT NOT NULL CHECK (json_valid(marks)),
  updated_at INTEGER NOT NULL,
  cleared_at INTEGER,
  rev        INTEGER NOT NULL
);
CREATE INDEX idx_read_marks_rev ON read_marks(user_id, rev);
