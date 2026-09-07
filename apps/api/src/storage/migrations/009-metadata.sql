CREATE TABLE metadata_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  library_id TEXT NOT NULL CHECK(length(library_id)>0),
  operation_id_hash TEXT NOT NULL CHECK(length(operation_id_hash)=64),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  kind TEXT NOT NULL CHECK(kind IN ('edit','retry','restore')),
  parent_job_id TEXT REFERENCES metadata_jobs(id),
  source_reference TEXT,
  usage_basis TEXT,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  UNIQUE(identity_key,operation_id_hash),
  CHECK((kind='edit')=(parent_job_id IS NULL)),
  CHECK(parent_job_id IS NULL OR parent_job_id<>id)
) STRICT;

CREATE TABLE metadata_items (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  job_id TEXT NOT NULL REFERENCES metadata_jobs(id),
  item_order INTEGER NOT NULL CHECK(item_order>=0),
  media_link_id TEXT NOT NULL REFERENCES media_links(id),
  file_identity TEXT NOT NULL CHECK(length(file_identity)=64),
  binding_revision INTEGER NOT NULL CHECK(binding_revision>0),
  original_track_id TEXT NOT NULL CHECK(length(original_track_id)>0),
  current_track_id TEXT NOT NULL CHECK(length(current_track_id)>0),
  expected_revision TEXT NOT NULL CHECK(length(expected_revision)>0),
  expected_digest TEXT NOT NULL CHECK(length(expected_digest)=64),
  patch_json TEXT NOT NULL CHECK(json_valid(patch_json) AND json_type(patch_json)='object'),
  actor_session_id TEXT NOT NULL REFERENCES sessions(id_hash),
  policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
  parent_item_id TEXT REFERENCES metadata_items(id),
  restore_backup_id TEXT REFERENCES metadata_backups(id),
  stage TEXT NOT NULL CHECK(stage IN ('queued','preparing','backed_up','prepared','file_saved','reflecting','succeeded','conflict','failed','recovery_required')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  stage_changed_at INTEGER NOT NULL CHECK(stage_changed_at>=0),
  file_saved_at INTEGER CHECK(file_saved_at>=0),
  reflected_at INTEGER CHECK(reflected_at>=file_saved_at),
  result_revision TEXT CHECK(length(result_revision)>0),
  result_digest TEXT CHECK(length(result_digest)=64),
  candidate_key TEXT,
  error_code TEXT,
  changed_fields_json TEXT NOT NULL CHECK(json_valid(changed_fields_json) AND json_type(changed_fields_json)='array'),
  UNIQUE(job_id,item_order),
  UNIQUE(job_id,media_link_id),
  UNIQUE(job_id,file_identity),
  CHECK(parent_item_id IS NULL OR parent_item_id<>id),
  CHECK((result_revision IS NULL)=(result_digest IS NULL)),
  CHECK(file_saved_at IS NULL OR result_revision IS NOT NULL),
  CHECK(stage NOT IN ('file_saved','reflecting','succeeded') OR file_saved_at IS NOT NULL),
  CHECK(stage<>'succeeded' OR (reflected_at IS NOT NULL AND error_code IS NULL)),
  CHECK(stage NOT IN ('conflict','failed','recovery_required') OR error_code IS NOT NULL)
) STRICT;

CREATE TABLE metadata_file_locks (
  file_identity TEXT PRIMARY KEY NOT NULL CHECK(length(file_identity)=64),
  item_id TEXT NOT NULL UNIQUE REFERENCES metadata_items(id),
  owner TEXT NOT NULL CHECK(length(owner)>0),
  generation INTEGER NOT NULL CHECK(generation>0),
  expires_at INTEGER NOT NULL CHECK(expires_at>=0)
) STRICT;

CREATE TABLE metadata_attempts (
  item_id TEXT NOT NULL REFERENCES metadata_items(id),
  generation INTEGER NOT NULL CHECK(generation>0),
  owner TEXT NOT NULL CHECK(length(owner)>0),
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  finished_at INTEGER CHECK(finished_at>=started_at),
  error_code TEXT,
  PRIMARY KEY(item_id,generation)
) STRICT;

CREATE TABLE metadata_backups (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  item_id TEXT NOT NULL UNIQUE REFERENCES metadata_items(id),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  library_id TEXT NOT NULL CHECK(length(library_id)>0),
  relative_key TEXT NOT NULL UNIQUE CHECK(length(relative_key)>0 AND relative_key NOT GLOB '/*' AND instr(relative_key,'..')=0 AND instr(relative_key,'\')=0 AND instr(relative_key,':')=0 AND instr(relative_key,char(0))=0),
  preimage_digest TEXT NOT NULL CHECK(length(preimage_digest)=64),
  size INTEGER NOT NULL CHECK(size>=0),
  mode INTEGER NOT NULL CHECK(mode>=0 AND mode<=4095),
  owner_profile_json TEXT NOT NULL CHECK(json_valid(owner_profile_json) AND json_type(owner_profile_json)='object'),
  parent_backup_id TEXT REFERENCES metadata_backups(id),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  CHECK(parent_backup_id IS NULL OR parent_backup_id<>id)
) STRICT;

CREATE TABLE metadata_cover_uploads (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  library_id TEXT NOT NULL CHECK(length(library_id)>0),
  operation_id_hash TEXT NOT NULL CHECK(length(operation_id_hash)=64),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  relative_key TEXT NOT NULL UNIQUE CHECK(length(relative_key)>0 AND relative_key NOT GLOB '/*' AND instr(relative_key,'..')=0 AND instr(relative_key,'\')=0 AND instr(relative_key,':')=0 AND instr(relative_key,char(0))=0),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
  size INTEGER NOT NULL CHECK(size>0),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>=created_at),
  UNIQUE(identity_key,operation_id_hash)
) STRICT;

CREATE TABLE metadata_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE REFERENCES metadata_items(id),
  media_link_id TEXT NOT NULL REFERENCES media_links(id),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  library_id TEXT NOT NULL CHECK(length(library_id)>0),
  old_revision TEXT NOT NULL CHECK(length(old_revision)>0),
  new_revision TEXT NOT NULL CHECK(length(new_revision)>0),
  related_ids_json TEXT NOT NULL CHECK(json_valid(related_ids_json) AND json_type(related_ids_json)='object'),
  cover_generation TEXT NOT NULL CHECK(length(cover_generation)>0),
  changed_fields_json TEXT NOT NULL CHECK(json_valid(changed_fields_json) AND json_type(changed_fields_json)='array'),
  reflection_result TEXT NOT NULL CHECK(reflection_result IN ('verified','reflection_mismatch','reference_conflict')),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;

CREATE TABLE metadata_worker_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  worker_id TEXT CHECK(length(worker_id)>0),
  status TEXT NOT NULL CHECK(status IN ('stopped','idle','working','unhealthy')),
  heartbeat_at INTEGER CHECK(heartbeat_at>=0),
  active_item_id TEXT REFERENCES metadata_items(id),
  CHECK((status='stopped')=(worker_id IS NULL)),
  CHECK((worker_id IS NULL)=(heartbeat_at IS NULL)),
  CHECK((status='working')=(active_item_id IS NOT NULL))
) STRICT;

CREATE INDEX metadata_jobs_history ON metadata_jobs(identity_key,library_id,created_at DESC,id DESC);
CREATE INDEX metadata_items_runnable ON metadata_items(stage,stage_changed_at,id);
CREATE INDEX metadata_items_file ON metadata_items(file_identity,stage,id);
CREATE INDEX metadata_changes_feed ON metadata_changes(library_id,sequence);
CREATE INDEX metadata_changes_latest ON metadata_changes(media_link_id,sequence DESC);
CREATE INDEX metadata_cover_expiry ON metadata_cover_uploads(expires_at,id);
INSERT INTO metadata_worker_state(singleton,status) VALUES(1,'stopped');
PRAGMA user_version=9;
