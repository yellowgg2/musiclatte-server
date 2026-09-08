CREATE TABLE scan_schedule (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK(interval_minutes BETWEEN 15 AND 10080),
  next_run_at INTEGER,
  last_started_at INTEGER,
  last_error TEXT CHECK(last_error IS NULL OR last_error IN ('forbidden','upstream_unavailable')),
  encrypted_proof TEXT,
  policy_revision INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO scan_schedule(singleton) VALUES(1);
PRAGMA user_version=14;
