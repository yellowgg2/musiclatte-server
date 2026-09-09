CREATE TABLE automation_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  credential_epoch TEXT NOT NULL CHECK(length(credential_epoch)=64)
) STRICT;
INSERT INTO automation_state(singleton,credential_epoch) VALUES(1,lower(hex(randomblob(32))));
CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instance(id),
  owner_username TEXT NOT NULL CHECK(length(owner_username)>0),
  name TEXT NOT NULL CHECK(length(name)>0),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  library_ids_json TEXT NOT NULL CHECK(json_valid(library_ids_json)),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  revoked_at INTEGER CHECK(revoked_at>=0),
  last_used_at INTEGER CHECK(last_used_at>=created_at),
  policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
  encrypted_proof TEXT,
  CHECK(revoked_at IS NOT NULL OR encrypted_proof IS NOT NULL)
) STRICT;
CREATE INDEX access_tokens_owner ON access_tokens(owner_username,created_at DESC,id DESC);
PRAGMA user_version=15;
