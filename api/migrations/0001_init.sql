-- 0001_init.sql — the tables the old MongoDB collections became, one by one.
-- Idempotent through `wrangler d1 migrations apply`, so every deploy can re-run it safely.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,               -- 24-hex id, same shape the share links always had
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  is_owner   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL                -- epoch ms (Mongo stored a Date)
);
-- The old partial unique index: at most one owner, enforced by SQLite.
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(is_owner) WHERE is_owner = 1;

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  mime       TEXT,
  has_thumb  INTEGER NOT NULL DEFAULT 0,     -- 0/1, read as a boolean by the API layer
  upload_id  TEXT,                           -- live R2 multipart upload, NULL once finished
  status     TEXT NOT NULL,                  -- uploading | ready | blocked
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_by_user  ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS files_by_status ON files(status, created_at DESC);

CREATE TABLE IF NOT EXISTS play_tokens (
  id         TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL               -- epoch ms; the cron sweep deletes past this point
);
CREATE INDEX IF NOT EXISTS tokens_by_file ON play_tokens(file_id);

CREATE TABLE IF NOT EXISTS views (
  file_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  day        TEXT NOT NULL,                  -- "YYYY-MM-DD" in TIMEZONE
  ip         TEXT,
  country    TEXT,
  created_at INTEGER NOT NULL,
  -- One view per file + device + day, enforced by the primary key (the old unique index).
  PRIMARY KEY (file_id, device_id, day)
);
CREATE INDEX IF NOT EXISTS views_per_ip_day ON views(file_id, ip, day);

CREATE TABLE IF NOT EXISTS file_daily (
  file_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, day)
);
CREATE INDEX IF NOT EXISTS daily_by_day ON file_daily(day);
