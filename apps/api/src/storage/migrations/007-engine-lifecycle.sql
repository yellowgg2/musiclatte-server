ALTER TABLE engine_state RENAME TO engine_state_v6;
CREATE TABLE engine_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_checked_at INTEGER CHECK (last_checked_at >= 0),
  last_check_succeeded_at INTEGER CHECK (last_check_succeeded_at >= 0),
  active_version TEXT CHECK (length(active_version) > 0),
  candidate_version TEXT CHECK (length(candidate_version) > 0),
  previous_version TEXT CHECK (length(previous_version) > 0),
  status TEXT NOT NULL CHECK (status IN ('never_checked','checking','up_to_date','candidate_pending_validation','active','update_failed','validation_failed','restored')),
  failure_code TEXT CHECK (failure_code IN ('update_failed','invalid_executable','invalid_hash','invalid_version','dependency_failed','source_probe_failed','source_mismatch','activation_failed','check_interrupted')),
  candidate_key TEXT,
  candidate_hash TEXT CHECK (candidate_hash IS NULL OR (length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^a-f0-9]*')),
  operation_token TEXT,
  operation_expires_at INTEGER CHECK (operation_expires_at >= 0),
  CHECK ((operation_token IS NULL) = (operation_expires_at IS NULL)),
  CHECK ((candidate_key IS NULL) = (candidate_hash IS NULL)),
  CHECK (candidate_key IS NULL OR candidate_version IS NOT NULL),
  CHECK (last_check_succeeded_at IS NULL OR last_check_succeeded_at <= last_checked_at),
  CHECK (status <> 'candidate_pending_validation' OR candidate_version IS NOT NULL),
  CHECK (candidate_version IS NULL OR candidate_version <> active_version),
  CHECK (previous_version IS NULL OR previous_version <> active_version)
) STRICT;
INSERT INTO engine_state(singleton,last_checked_at,last_check_succeeded_at,active_version,candidate_version,previous_version,status,failure_code)
SELECT singleton,last_checked_at,last_check_succeeded_at,active_version,NULL,previous_version,
  CASE WHEN status='failed' THEN 'update_failed'
       WHEN status='checking' THEN 'update_failed'
       WHEN status='candidate_ready' THEN 'validation_failed'
       WHEN last_checked_at IS NULL THEN 'never_checked' ELSE 'up_to_date' END,
  CASE WHEN status='failed' THEN 'update_failed'
       WHEN status='checking' THEN 'check_interrupted'
       WHEN status='candidate_ready' THEN 'invalid_executable' ELSE NULL END
FROM engine_state_v6;
DROP TABLE engine_state_v6;
PRAGMA user_version = 7;
