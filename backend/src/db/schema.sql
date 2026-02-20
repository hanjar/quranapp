CREATE TABLE IF NOT EXISTS bookmarks (
  key TEXT PRIMARY KEY,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  surah_name_ar TEXT,
  surah_name_en TEXT,
  folder TEXT DEFAULT 'Umum',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  name TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  key TEXT PRIMARY KEY,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default folder
INSERT OR IGNORE INTO folders (name) VALUES ('Umum');

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);
CREATE INDEX IF NOT EXISTS idx_bookmarks_surah ON bookmarks(surah);
CREATE INDEX IF NOT EXISTS idx_notes_surah ON notes(surah);
