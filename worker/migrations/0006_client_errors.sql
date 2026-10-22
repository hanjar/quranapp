-- Automatic client error reports (storage/app errors) so failures on a device can be
-- diagnosed without the user copying messages. No page content, no IP; kept 30 days.
CREATE TABLE client_errors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,
  occurred_at  INTEGER NOT NULL,
  device_id    TEXT,
  user_id      TEXT,
  app_version  TEXT,
  standalone   INTEGER,
  platform     TEXT,
  op           TEXT NOT NULL,
  name         TEXT NOT NULL,
  message      TEXT NOT NULL
);
CREATE INDEX idx_client_errors_created ON client_errors(created_at);
CREATE INDEX idx_client_errors_user ON client_errors(user_id, created_at);
