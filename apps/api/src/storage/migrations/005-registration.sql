CREATE TABLE registration_attempts (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES import_items(id),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('registration_pending','registration_timeout','registration_upstream','registration_path','registration_ambiguous','registration_cancelled','registration_conflict'))
) STRICT;
CREATE INDEX registration_attempts_due ON registration_attempts(next_attempt_at,item_id);
CREATE TABLE registration_cycle (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  owner TEXT,
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  next_scan_at INTEGER NOT NULL CHECK (next_scan_at >= 0)
) STRICT;
INSERT INTO registration_cycle VALUES(1,NULL,0,0);
PRAGMA user_version = 5;
