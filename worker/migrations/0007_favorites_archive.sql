-- Favorites and archived bookmarks / folders (khatam archive).
-- bookmarks.kind had CHECK (kind IN ('verse','page')), so the table is rebuilt SQLite-style.
-- Columns: 0001_init.sql plus folder_id/note from 0002_folders_notes.sql, plus archived_at.
CREATE TABLE bookmarks_new (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semantic_key TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('verse', 'page', 'favorite')),
  edition_id   TEXT NOT NULL,
  page         INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
  surah        INTEGER CHECK (surah IS NULL OR surah BETWEEN 1 AND 114),
  ayah         INTEGER CHECK (ayah IS NULL OR ayah BETWEEN 1 AND 286),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  rev          INTEGER NOT NULL,
  folder_id    TEXT,
  note         TEXT,
  archived_at  INTEGER,
  PRIMARY KEY (user_id, id)
);

INSERT INTO bookmarks_new (id, user_id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev, folder_id, note, archived_at)
  SELECT id, user_id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev, folder_id, note, NULL FROM bookmarks;

DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;

-- At most one ACTIVE (not deleted, not archived) bookmark per semantic target.
CREATE UNIQUE INDEX uq_bookmarks_active_key
  ON bookmarks(user_id, semantic_key) WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX idx_bookmarks_rev ON bookmarks(user_id, rev);
CREATE INDEX idx_bookmarks_tombstones ON bookmarks(deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE folders ADD COLUMN archived_at INTEGER;
