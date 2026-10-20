-- Minimal audit trail for in-app feedback (abuse handling). No message text, no raw IP.
CREATE TABLE feedback (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  category     TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  ip_hash      TEXT NOT NULL -- sha256(ip + UTC date), truncated
);
CREATE INDEX idx_feedback_created ON feedback(created_at);
CREATE INDEX idx_feedback_ip ON feedback(ip_hash, created_at);
