CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  identity_key TEXT NOT NULL CHECK (length(identity_key) = 64),
  library_id TEXT NOT NULL CHECK (length(library_id) > 0),
  operation_id_hash TEXT NOT NULL CHECK (length(operation_id_hash) = 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  retry_of_job_id TEXT REFERENCES import_jobs(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  cancel_requested_at INTEGER CHECK (cancel_requested_at IS NULL OR cancel_requested_at >= created_at),
  UNIQUE (identity_key, operation_id_hash),
  CHECK (retry_of_job_id IS NULL OR retry_of_job_id <> id)
) STRICT;

CREATE TABLE media_links (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  library_id TEXT NOT NULL CHECK (length(library_id) > 0),
  relative_file_key TEXT NOT NULL CHECK (
    length(relative_file_key) > 0
    AND instr(relative_file_key, char(0)) = 0
    AND instr(relative_file_key, '\') = 0
    AND relative_file_key NOT GLOB '/*'
    AND relative_file_key NOT GLOB '[A-Za-z]:*'
    AND relative_file_key <> '.'
    AND relative_file_key <> '..'
    AND relative_file_key NOT LIKE './%'
    AND relative_file_key NOT LIKE '../%'
    AND relative_file_key NOT LIKE '%/./%'
    AND relative_file_key NOT LIKE '%/../%'
    AND relative_file_key NOT LIKE '%/.'
    AND relative_file_key NOT LIKE '%/..'
    AND relative_file_key NOT LIKE '%//%'
  ),
  gonic_song_id TEXT NOT NULL CHECK (length(gonic_song_id) > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'unavailable')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  validated_at INTEGER CHECK (validated_at IS NULL OR validated_at >= created_at),
  UNIQUE (library_id, relative_file_key),
  UNIQUE (library_id, gonic_song_id)
) STRICT;

CREATE TABLE import_items (
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
  CHECK (stage <> 'duplicate' OR media_link_id IS NOT NULL)
) STRICT;

CREATE TABLE download_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  import_item_id TEXT NOT NULL UNIQUE REFERENCES import_items(id),
  identity_key TEXT NOT NULL CHECK (length(identity_key) = 64),
  library_id TEXT NOT NULL CHECK (length(library_id) > 0),
  download_completed_at INTEGER NOT NULL CHECK (download_completed_at >= 0),
  registered_at INTEGER CHECK (
    registered_at IS NULL OR registered_at >= download_completed_at
  )
) STRICT;

CREATE TABLE engine_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  last_check_succeeded_at INTEGER CHECK (
    last_check_succeeded_at IS NULL OR last_check_succeeded_at >= 0
  ),
  active_version TEXT CHECK (active_version IS NULL OR length(active_version) > 0),
  candidate_version TEXT CHECK (candidate_version IS NULL OR length(candidate_version) > 0),
  previous_version TEXT CHECK (previous_version IS NULL OR length(previous_version) > 0),
  status TEXT NOT NULL CHECK (
    status IN ('uninitialized', 'idle', 'checking', 'candidate_ready', 'failed')
  ),
  CHECK (
    last_checked_at IS NULL
    OR last_check_succeeded_at IS NULL
    OR last_check_succeeded_at <= last_checked_at
  ),
  CHECK (status = 'uninitialized' OR active_version IS NOT NULL),
  CHECK (status <> 'candidate_ready' OR candidate_version IS NOT NULL),
  CHECK (candidate_version IS NULL OR candidate_version <> active_version),
  CHECK (previous_version IS NULL OR previous_version <> active_version)
) STRICT;

CREATE TABLE worker_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) > 0),
  status TEXT NOT NULL CHECK (status IN ('stopped', 'idle', 'working', 'unhealthy')),
  heartbeat_at INTEGER CHECK (heartbeat_at IS NULL OR heartbeat_at >= 0),
  active_item_id TEXT REFERENCES import_items(id),
  CHECK (status = 'working' OR active_item_id IS NULL),
  CHECK (
    (status = 'stopped' AND worker_id IS NULL AND heartbeat_at IS NULL)
    OR (status <> 'stopped' AND worker_id IS NOT NULL AND heartbeat_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX import_items_runnable ON import_items(stage, lease_expires_at, id);
CREATE INDEX import_items_source_duplicate ON import_items(source_id, stage, id);
CREATE INDEX download_events_recent ON download_events(
  identity_key,
  library_id,
  download_completed_at DESC,
  id DESC
);

INSERT INTO engine_state(singleton, status) VALUES(1, 'uninitialized');
INSERT INTO worker_state(singleton, status) VALUES(1, 'stopped');

PRAGMA user_version = 3;
