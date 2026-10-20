-- Phase 2: bookmark folders and notes.
CREATE TABLE folders (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL, -- lower-cased trimmed name; case-insensitive uniqueness among active rows
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX uq_folders_active_name ON folders(user_id, name_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_folders_rev ON folders(user_id, rev);
CREATE INDEX idx_folders_tombstones ON folders(deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE bookmarks ADD COLUMN folder_id TEXT;
ALTER TABLE bookmarks ADD COLUMN note TEXT;
