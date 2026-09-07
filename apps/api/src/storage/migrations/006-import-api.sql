CREATE TABLE import_items_v6 (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  job_id TEXT NOT NULL REFERENCES import_jobs(id),
  item_order INTEGER NOT NULL CHECK (item_order >= 0),
  source_id TEXT NOT NULL CHECK (length(source_id) > 0),
  observed_title TEXT CHECK (observed_title IS NULL OR length(observed_title) > 0),
  observed_channel TEXT CHECK (observed_channel IS NULL OR length(observed_channel) > 0),
  observed_channel_id TEXT CHECK (observed_channel_id IS NULL OR length(observed_channel_id) > 0),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'queued',
      'resolving',
      'downloading',
      'postprocessing',
      'publishing',
      'registering',
      'ready',
      'failed',
      'cancelled',
      'duplicate'
    )
  ),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) > 0),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) > 0),
  lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at >= 0),
  engine_version TEXT CHECK (engine_version IS NULL OR length(engine_version) > 0),
  media_link_id TEXT REFERENCES media_links(id),
  duplicate_of_item_id TEXT REFERENCES import_items(id),
  stage_changed_at INTEGER NOT NULL CHECK (stage_changed_at >= 0),
  resolving_at INTEGER CHECK (resolving_at IS NULL OR resolving_at >= 0),
  downloading_at INTEGER CHECK (downloading_at IS NULL OR downloading_at >= 0),
  postprocessing_at INTEGER CHECK (postprocessing_at IS NULL OR postprocessing_at >= 0),
  publishing_at INTEGER CHECK (publishing_at IS NULL OR publishing_at >= 0),
  registering_at INTEGER CHECK (registering_at IS NULL OR registering_at >= 0),
  ready_at INTEGER CHECK (ready_at IS NULL OR ready_at >= 0),
  UNIQUE (job_id, item_order),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (stage NOT IN ('ready', 'failed', 'cancelled', 'duplicate') OR lease_owner IS NULL),
  CHECK ((stage = 'failed') = (failure_code IS NOT NULL)),
  CHECK (stage <> 'ready' OR (media_link_id IS NOT NULL AND ready_at IS NOT NULL)),
  CHECK (stage <> 'cancelled' OR media_link_id IS NULL),
  CHECK (stage <> 'duplicate' OR media_link_id IS NOT NULL OR duplicate_of_item_id IS NOT NULL),
  CHECK (duplicate_of_item_id IS NULL OR (stage = 'duplicate' AND duplicate_of_item_id <> id))
) STRICT;

INSERT INTO import_items_v6(id,job_id,item_order,source_id,observed_title,observed_channel,observed_channel_id,stage,failure_code,attempt,lease_owner,lease_expires_at,engine_version,media_link_id,stage_changed_at,resolving_at,downloading_at,postprocessing_at,publishing_at,registering_at,ready_at) SELECT id,job_id,item_order,source_id,observed_title,observed_channel,observed_channel_id,stage,failure_code,attempt,lease_owner,lease_expires_at,engine_version,media_link_id,stage_changed_at,resolving_at,downloading_at,postprocessing_at,publishing_at,registering_at,ready_at FROM import_items;
DROP TABLE import_items;
ALTER TABLE import_items_v6 RENAME TO import_items;
CREATE INDEX import_items_runnable ON import_items(stage, lease_expires_at, id);
CREATE INDEX import_items_source_duplicate ON import_items(source_id, stage, id);
CREATE INDEX import_jobs_history ON import_jobs(identity_key, created_at DESC, id DESC);
PRAGMA user_version = 6;
