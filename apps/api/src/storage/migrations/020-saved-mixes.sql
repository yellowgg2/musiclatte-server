CREATE TABLE saved_mixes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 identity_key TEXT NOT NULL,
 name TEXT NOT NULL,
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 created_at INTEGER NOT NULL CHECK(created_at >= 0),
 updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
 deleted_at INTEGER CHECK(deleted_at >= updated_at)
) STRICT;
CREATE INDEX saved_mixes_owner_page ON saved_mixes(identity_key,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE mix_operations (
 identity_key TEXT NOT NULL,
 operation_id_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('create','update','delete')),
 resource_id TEXT NOT NULL REFERENCES saved_mixes(id),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL CHECK(created_at >= 0),
 PRIMARY KEY(identity_key,operation_id_hash)
) STRICT;
PRAGMA user_version=20;
