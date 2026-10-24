-- Khatam bersama (One Day One Juz style): a group shares the 30 juz of a round; each member reads
-- the juz assigned to them and marks it done. When all 30 are done the group has a khatam and the
-- next round shifts every assignment by one juz.
CREATE TABLE khatam_groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  invite_code  TEXT NOT NULL UNIQUE,
  round        INTEGER NOT NULL DEFAULT 1,
  khatam_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id  TEXT NOT NULL REFERENCES khatam_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Opaque id shown to other members (never the account id).
  member_id TEXT NOT NULL,
  nickname  TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE UNIQUE INDEX idx_group_members_mid ON group_members(group_id, member_id);

CREATE TABLE group_juz (
  group_id  TEXT NOT NULL REFERENCES khatam_groups(id) ON DELETE CASCADE,
  round     INTEGER NOT NULL,
  juz       INTEGER NOT NULL CHECK (juz BETWEEN 1 AND 30),
  member_id TEXT,
  done_at   INTEGER,
  PRIMARY KEY (group_id, round, juz)
);
