CREATE TABLE instance (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL UNIQUE CHECK (length(id) > 0),
  policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
  key_id TEXT NOT NULL CHECK (length(key_id) = 64)
) STRICT;
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY NOT NULL CHECK (length(id_hash) = 64),
  instance_id TEXT NOT NULL REFERENCES instance(id),
  policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
  username TEXT NOT NULL CHECK (length(username) > 0),
  encrypted_proof TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER CHECK (revoked_at >= 0),
  CHECK (revoked_at IS NOT NULL OR encrypted_proof IS NOT NULL)
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
PRAGMA application_id = 1296843092;
PRAGMA user_version = 1;
