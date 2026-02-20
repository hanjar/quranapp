
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,          -- UUID or Google ID
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,           -- Nullable for Google-only users
  google_id TEXT UNIQUE,        -- Nullable
  name TEXT,
  picture TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);


-- Folders table (updated to UUID)
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,           -- UUID
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bookmarks table (updated with folder_id and label)
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,           -- UUID
  user_id TEXT NOT NULL,         -- Foreign key to users
  folder_id TEXT,                -- Link to folders (nullable for root? or default folder)
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  label TEXT,                    -- User label for the bookmark
  key TEXT,                      -- Legacy key or "surah:ayah" for queries
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

-- Notes table (updated to link to user)
CREATE TABLE IF NOT EXISTS notes (
  key TEXT PRIMARY KEY,          -- "user_id:2:255"
  user_id TEXT NOT NULL,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
