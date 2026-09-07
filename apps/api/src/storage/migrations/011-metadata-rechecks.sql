CREATE TABLE metadata_rechecks (
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  operation_id_hash TEXT NOT NULL CHECK(length(operation_id_hash)=64),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  job_id TEXT NOT NULL REFERENCES metadata_jobs(id),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(identity_key,operation_id_hash)
) STRICT;
PRAGMA user_version=11;
