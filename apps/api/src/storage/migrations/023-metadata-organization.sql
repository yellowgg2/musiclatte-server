CREATE TABLE organization_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  library_id TEXT NOT NULL CHECK(length(library_id)>0),
  operation_id_hash TEXT NOT NULL CHECK(length(operation_id_hash)=64),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  actor_token_id TEXT NOT NULL REFERENCES access_tokens(id),
  policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
  policy_version TEXT NOT NULL CHECK(policy_version='id3-managed-v1'),
  metadata_job_id TEXT NOT NULL REFERENCES metadata_jobs(id),
  metadata_revision TEXT NOT NULL CHECK(length(metadata_revision)>0),
  source_evidence_json TEXT NOT NULL CHECK(json_valid(source_evidence_json) AND json_type(source_evidence_json)='array'),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  UNIQUE(identity_key,operation_id_hash)
) STRICT;

CREATE TABLE organization_items (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  job_id TEXT NOT NULL UNIQUE REFERENCES organization_jobs(id),
  media_link_id TEXT NOT NULL REFERENCES media_links(id),
  source_key TEXT NOT NULL CHECK(length(source_key)>0 AND source_key NOT GLOB '/*' AND instr(source_key,'..')=0 AND instr(source_key,'\')=0 AND instr(source_key,':')=0),
  target_key TEXT NOT NULL CHECK(length(target_key)>0 AND target_key NOT GLOB '/*' AND instr(target_key,'..')=0 AND instr(target_key,'\')=0 AND instr(target_key,':')=0),
  old_track_id TEXT NOT NULL CHECK(length(old_track_id)>0),
  new_track_id TEXT,
  file_identity TEXT NOT NULL CHECK(length(file_identity)=64),
  audio_identity TEXT NOT NULL CHECK(length(audio_identity)=64),
  baseline_json TEXT CHECK(baseline_json IS NULL OR (json_valid(baseline_json) AND json_type(baseline_json)='object')),
  stage TEXT NOT NULL CHECK(stage IN ('queued','validating','references_captured','moving','moved','scanning','rebound','migrating_references','verifying','succeeded','failed','conflict','recovery_required')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  lease_owner TEXT,
  lease_expires_at INTEGER CHECK(lease_expires_at>=0),
  encrypted_job_grant TEXT,
  grant_epoch TEXT,
  error_code TEXT,
  next_owner TEXT CHECK(next_owner IS NULL OR next_owner IN ('filesystem','gonic','references','verification')),
  stage_changed_at INTEGER NOT NULL CHECK(stage_changed_at>=0),
  CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL)),
  CHECK((encrypted_job_grant IS NULL)=(grant_epoch IS NULL)),
  CHECK(stage NOT IN ('failed','conflict','recovery_required') OR error_code IS NOT NULL),
  CHECK(stage<>'succeeded' OR (error_code IS NULL AND new_track_id IS NOT NULL))
) STRICT;
CREATE INDEX organization_items_runnable ON organization_items(stage,stage_changed_at,id);

CREATE TABLE organization_attempts (
  item_id TEXT NOT NULL REFERENCES organization_items(id),
  generation INTEGER NOT NULL CHECK(generation>0),
  owner TEXT NOT NULL CHECK(length(owner)>0),
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  finished_at INTEGER CHECK(finished_at>=started_at),
  error_code TEXT,
  PRIMARY KEY(item_id,generation)
) STRICT;
CREATE TRIGGER organization_attempts_no_delete BEFORE DELETE ON organization_attempts BEGIN SELECT RAISE(ABORT,'append-only attempt'); END;

CREATE TABLE organization_reference_checkpoints (
  item_id TEXT NOT NULL REFERENCES organization_items(id),
  kind TEXT NOT NULL CHECK(kind IN ('playlist','star')),
  reference_id TEXT NOT NULL,
  baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),
  desired_json TEXT NOT NULL CHECK(json_valid(desired_json)),
  status TEXT NOT NULL CHECK(status IN ('pending','completed','conflict','failed')),
  error_code TEXT,
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  PRIMARY KEY(item_id,kind,reference_id)
) STRICT;

CREATE TABLE organization_source_locations (
  media_link_id TEXT PRIMARY KEY REFERENCES media_links(id),
  source_id TEXT NOT NULL CHECK(length(source_id)>0),
  managed_key TEXT NOT NULL CHECK(length(managed_key)>0),
  organization_item_id TEXT NOT NULL UNIQUE REFERENCES organization_items(id),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0)
) STRICT;
CREATE UNIQUE INDEX organization_source_id ON organization_source_locations(source_id);

CREATE TABLE organization_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES organization_items(id),
  kind TEXT NOT NULL CHECK(length(kind)>0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;
CREATE TRIGGER organization_events_no_update BEFORE UPDATE ON organization_events BEGIN SELECT RAISE(ABORT,'append-only event'); END;
CREATE TRIGGER organization_events_no_delete BEFORE DELETE ON organization_events BEGIN SELECT RAISE(ABORT,'append-only event'); END;

PRAGMA user_version=23;
