CREATE TABLE playlist_operations (
  identity_key TEXT NOT NULL CHECK (length(identity_key) = 64),
  operation_id_hash TEXT NOT NULL CHECK (length(operation_id_hash) = 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  kind TEXT NOT NULL CHECK (kind IN ('create', 'rename', 'append', 'remove', 'reorder', 'delete')),
  resource_id TEXT CHECK (resource_id IS NULL OR length(resource_id) > 0),
  before_revision TEXT CHECK (before_revision IS NULL OR length(before_revision) > 0),
  after_revision TEXT CHECK (after_revision IS NULL OR length(after_revision) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'uncertain', 'failed')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= created_at),
  PRIMARY KEY (identity_key, operation_id_hash),
  CHECK (
    (
      status = 'pending'
      AND finished_at IS NULL
      AND resource_id IS NULL
      AND before_revision IS NULL
      AND after_revision IS NULL
    )
    OR (
      status IN ('uncertain', 'failed')
      AND finished_at IS NOT NULL
      AND resource_id IS NULL
      AND before_revision IS NULL
      AND after_revision IS NULL
    )
    OR (status = 'applied' AND finished_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX playlist_operations_status ON playlist_operations(status, created_at);
PRAGMA user_version = 2;
