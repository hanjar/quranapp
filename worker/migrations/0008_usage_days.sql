-- Anonymous usage counts: one row per device per day (Asia/Jakarta date). The device is a
-- salted hash of the app's random device id, never an account, IP or user agent. Kept 400 days.
CREATE TABLE usage_days (
  day         TEXT NOT NULL,
  device      TEXT NOT NULL,
  standalone  INTEGER NOT NULL DEFAULT 0,
  signed_in   INTEGER NOT NULL DEFAULT 0,
  app_version TEXT,
  PRIMARY KEY (day, device)
) WITHOUT ROWID;
