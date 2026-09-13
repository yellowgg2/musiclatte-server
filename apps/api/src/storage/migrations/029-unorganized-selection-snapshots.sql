ALTER TABLE curation_tracks ADD COLUMN album TEXT;

CREATE TABLE organization_selection_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  actor_token_id TEXT NOT NULL REFERENCES access_tokens(id),
  scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
  inventory_revision TEXT NOT NULL CHECK(length(inventory_revision)=64),
  captured_at INTEGER NOT NULL CHECK(captured_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>captured_at),
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json) AND json_type(summary_json)='object')
) STRICT;
CREATE INDEX organization_selection_snapshot_expiry
ON organization_selection_snapshots(expires_at);

CREATE TABLE organization_selection_snapshot_items (
  selection_id TEXT NOT NULL REFERENCES organization_selection_snapshots(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  media_link_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  PRIMARY KEY(selection_id,ordinal),
  UNIQUE(selection_id,media_link_id)
) STRICT;

PRAGMA user_version=29;
