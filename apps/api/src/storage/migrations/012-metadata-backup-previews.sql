CREATE TABLE metadata_backup_previews (
  backup_id TEXT PRIMARY KEY NOT NULL REFERENCES metadata_backups(id),
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json) AND json_type(summary_json)='object')
) STRICT;
PRAGMA user_version=12;
