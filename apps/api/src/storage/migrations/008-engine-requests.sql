CREATE TABLE engine_requests (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  action TEXT NOT NULL CHECK (action IN ('check_now', 'restore_previous')),
  active_version TEXT NOT NULL,
  previous_version TEXT,
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  restored_active_version TEXT,
  restored_previous_version TEXT,
  owner TEXT,
  expires_at INTEGER CHECK (expires_at >= 0),
  CHECK ((owner IS NULL) = (expires_at IS NULL)),
  CHECK ((status = 'running') = (owner IS NOT NULL)),
  CHECK (action <> 'restore_previous' OR previous_version IS NOT NULL)
) STRICT;
PRAGMA user_version = 8;
