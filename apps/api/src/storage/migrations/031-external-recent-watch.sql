DROP TRIGGER curation_import_published;
DROP TRIGGER curation_import_registered;
DROP INDEX download_events_recent;

CREATE TABLE download_events_v31 (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
  import_item_id TEXT UNIQUE REFERENCES import_items(id),
  media_link_id TEXT NOT NULL REFERENCES media_links(id),
  provenance TEXT NOT NULL CHECK(provenance IN ('musiclatte', 'external')),
  identity_key TEXT NOT NULL CHECK(length(identity_key) = 64),
  library_id TEXT NOT NULL CHECK(length(library_id) > 0),
  download_completed_at INTEGER NOT NULL CHECK(download_completed_at >= 0),
  registered_at INTEGER CHECK(registered_at IS NULL OR registered_at >= download_completed_at),
  CHECK(
    (provenance = 'musiclatte' AND import_item_id IS NOT NULL) OR
    (provenance = 'external' AND import_item_id IS NULL)
  )
) STRICT;

INSERT INTO download_events_v31(
  rowid,
  id,
  import_item_id,
  media_link_id,
  provenance,
  identity_key,
  library_id,
  download_completed_at,
  registered_at
)
SELECT
  e.rowid,
  e.id,
  e.import_item_id,
  i.media_link_id,
  'musiclatte',
  e.identity_key,
  e.library_id,
  e.download_completed_at,
  e.registered_at
FROM download_events AS e
JOIN import_items AS i ON i.id = e.import_item_id;

CREATE TABLE download_events_v31_guard (
  unmatched_count INTEGER NOT NULL CHECK(unmatched_count = 0)
) STRICT;

INSERT INTO download_events_v31_guard(unmatched_count)
SELECT
  (SELECT count(*) FROM download_events) -
  (SELECT count(*) FROM download_events_v31);

DROP TABLE download_events_v31_guard;
DROP TABLE download_events;
ALTER TABLE download_events_v31 RENAME TO download_events;

CREATE INDEX download_events_recent ON download_events(
  identity_key,
  library_id,
  download_completed_at DESC,
  id DESC
);

CREATE TRIGGER curation_import_published
AFTER UPDATE OF stage ON import_items
WHEN NEW.stage = 'registering' AND OLD.stage = 'publishing'
BEGIN
  INSERT INTO curation_source_events(
    library_id,
    media_link_id,
    track_id,
    kind,
    source_key,
    created_at
  )
  SELECT
    e.library_id,
    NEW.media_link_id,
    m.gonic_song_id,
    'import_published',
    'import:' || e.id,
    e.download_completed_at
  FROM download_events AS e
  JOIN media_links AS m ON m.id = NEW.media_link_id
  WHERE e.import_item_id = NEW.id AND e.provenance = 'musiclatte';
END;

CREATE TRIGGER curation_import_registered
AFTER UPDATE OF registered_at ON download_events
WHEN
  NEW.registered_at IS NOT NULL AND
  OLD.registered_at IS NULL AND
  NEW.provenance = 'musiclatte'
BEGIN
  INSERT INTO curation_source_events(
    library_id,
    media_link_id,
    track_id,
    kind,
    source_key,
    created_at
  )
  SELECT
    NEW.library_id,
    NEW.media_link_id,
    m.gonic_song_id,
    'import_registered',
    'registered:' || NEW.id,
    NEW.registered_at
  FROM media_links AS m
  WHERE m.id = NEW.media_link_id;
END;

CREATE TABLE external_watch_owners (
  library_id TEXT NOT NULL CHECK(length(library_id) > 0),
  account_directory TEXT NOT NULL CHECK(
    length(account_directory) > 0 AND
    account_directory NOT IN ('.', '..') AND
    instr(account_directory, '/') = 0 AND
    instr(account_directory, char(92)) = 0
  ),
  username TEXT NOT NULL CHECK(length(username) > 0),
  identity_key TEXT NOT NULL CHECK(length(identity_key) = 64),
  instance_id TEXT NOT NULL CHECK(length(instance_id) > 0),
  policy_revision INTEGER NOT NULL CHECK(policy_revision >= 1),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  PRIMARY KEY(library_id, account_directory),
  UNIQUE(library_id, username),
  UNIQUE(library_id, identity_key),
  UNIQUE(library_id, account_directory, identity_key)
) STRICT;

CREATE TABLE external_watch_roots (
  library_id TEXT NOT NULL,
  account_directory TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('baselining', 'active', 'blocked')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  continuation_json TEXT CHECK(
    continuation_json IS NULL OR
    (json_valid(continuation_json) AND json_type(continuation_json) = 'object')
  ),
  root_device INTEGER CHECK(root_device IS NULL OR root_device >= 0),
  root_inode INTEGER CHECK(root_inode IS NULL OR root_inode >= 0),
  scan_started_at INTEGER CHECK(scan_started_at IS NULL OR scan_started_at >= 0),
  scan_completed_at INTEGER CHECK(scan_completed_at IS NULL OR scan_completed_at >= 0),
  next_reconcile_at INTEGER NOT NULL CHECK(next_reconcile_at >= 0),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) > 0),
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) > 0),
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR lease_expires_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  PRIMARY KEY(library_id, account_directory),
  FOREIGN KEY(library_id, account_directory, identity_key)
    REFERENCES external_watch_owners(library_id, account_directory, identity_key)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK((root_device IS NULL) = (root_inode IS NULL)),
  CHECK((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK(state <> 'active' OR scan_completed_at IS NOT NULL)
) STRICT;

CREATE TABLE external_file_observations (
  library_id TEXT NOT NULL,
  relative_file_key TEXT NOT NULL CHECK(
    length(relative_file_key) > 0 AND
    substr(relative_file_key, 1, 1) <> '/' AND
    instr(relative_file_key, char(92)) = 0 AND
    relative_file_key NOT LIKE '../%' AND
    relative_file_key NOT LIKE '%/../%' AND
    relative_file_key NOT LIKE '%/..'
  ),
  account_directory TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(
    state IN ('baseline', 'settling', 'validating', 'registering', 'ready', 'absent', 'rejected')
  ),
  device INTEGER CHECK(device IS NULL OR device >= 0),
  inode INTEGER CHECK(inode IS NULL OR inode >= 0),
  size INTEGER CHECK(size IS NULL OR size >= 0),
  mtime_ns INTEGER CHECK(mtime_ns IS NULL OR mtime_ns >= 0),
  ctime_ns INTEGER CHECK(ctime_ns IS NULL OR ctime_ns >= 0),
  link_count INTEGER CHECK(link_count IS NULL OR link_count >= 1),
  first_seen_at INTEGER NOT NULL CHECK(first_seen_at >= 0),
  stable_since_at INTEGER CHECK(stable_since_at IS NULL OR stable_since_at >= first_seen_at),
  last_seen_at INTEGER NOT NULL CHECK(last_seen_at >= first_seen_at),
  next_attempt_at INTEGER NOT NULL CHECK(next_attempt_at >= 0),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code) > 0),
  event_id TEXT UNIQUE REFERENCES download_events(id),
  media_link_id TEXT REFERENCES media_links(id),
  lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) > 0),
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR lease_expires_at >= 0),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  PRIMARY KEY(library_id, relative_file_key),
  FOREIGN KEY(library_id, account_directory, identity_key)
    REFERENCES external_watch_owners(library_id, account_directory, identity_key)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK(
    (device IS NULL AND inode IS NULL AND size IS NULL AND mtime_ns IS NULL AND ctime_ns IS NULL AND link_count IS NULL) OR
    (device IS NOT NULL AND inode IS NOT NULL AND size IS NOT NULL AND mtime_ns IS NOT NULL AND ctime_ns IS NOT NULL AND link_count IS NOT NULL)
  ),
  CHECK((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK((event_id IS NULL) = (media_link_id IS NULL)),
  CHECK(state NOT IN ('registering', 'ready') OR event_id IS NOT NULL),
  CHECK(state <> 'ready' OR failure_code IS NULL)
) STRICT;

CREATE INDEX external_watch_roots_runnable ON external_watch_roots(
  state,
  next_reconcile_at,
  lease_expires_at,
  library_id,
  account_directory
);

CREATE INDEX external_file_observations_runnable ON external_file_observations(
  state,
  next_attempt_at,
  lease_expires_at,
  library_id,
  relative_file_key
);

PRAGMA user_version = 31;
