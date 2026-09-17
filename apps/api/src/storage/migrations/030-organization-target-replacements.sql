CREATE TABLE organization_target_replacements (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_items(id),
  displaced_media_link_id TEXT NOT NULL REFERENCES media_links(id),
  displaced_track_id TEXT NOT NULL CHECK(length(displaced_track_id)>0),
  operation_id_hash TEXT NOT NULL UNIQUE CHECK(length(operation_id_hash)=64),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  backup_receipt_digest TEXT NOT NULL CHECK(length(backup_receipt_digest)=64),
  reference_snapshot_digests_json TEXT NOT NULL CHECK(
    json_valid(reference_snapshot_digests_json) AND
    json_type(reference_snapshot_digests_json)='array' AND
    json_array_length(reference_snapshot_digests_json)>0 AND
    json_array_length(reference_snapshot_digests_json)<=16
  ),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;

PRAGMA user_version=30;
