ALTER TABLE metadata_items ADD COLUMN next_reflection_at INTEGER NOT NULL DEFAULT 0 CHECK(next_reflection_at>=0);
CREATE TABLE metadata_item_evidence (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES metadata_items(id),
  references_json TEXT NOT NULL CHECK(json_valid(references_json) AND json_type(references_json)='object'),
  reflection_json TEXT CHECK(json_valid(reflection_json) AND json_type(reflection_json)='object'),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0)
) STRICT;
PRAGMA user_version=10;
