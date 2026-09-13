CREATE TABLE organization_items_v27 (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  job_id TEXT NOT NULL UNIQUE REFERENCES organization_jobs(id),
  media_link_id TEXT NOT NULL REFERENCES media_links(id),
  source_key TEXT NOT NULL CHECK(
    length(source_key)>0 AND
    source_key NOT GLOB '/*' AND
    source_key NOT GLOB '*/' AND
    instr(source_key,'//')=0 AND
    ('/' || source_key || '/') NOT GLOB '*/../*' AND
    ('/' || source_key || '/') NOT GLOB '*/./*' AND
    instr(source_key,'\')=0 AND
    instr(source_key,':')=0
  ),
  target_key TEXT NOT NULL CHECK(
    length(target_key)>0 AND
    target_key NOT GLOB '/*' AND
    target_key NOT GLOB '*/' AND
    instr(target_key,'//')=0 AND
    ('/' || target_key || '/') NOT GLOB '*/../*' AND
    ('/' || target_key || '/') NOT GLOB '*/./*' AND
    instr(target_key,'\')=0 AND
    instr(target_key,':')=0
  ),
  old_track_id TEXT NOT NULL CHECK(length(old_track_id)>0),
  new_track_id TEXT,
  file_identity TEXT NOT NULL CHECK(length(file_identity)=64),
  audio_identity TEXT NOT NULL CHECK(length(audio_identity)=64),
  baseline_json TEXT CHECK(
    baseline_json IS NULL OR
    (json_valid(baseline_json) AND json_type(baseline_json)='object')
  ),
  stage TEXT NOT NULL CHECK(stage IN (
    'queued','validating','references_captured','moving','moved','scanning','rebound',
    'migrating_references','verifying','succeeded','failed','conflict','recovery_required'
  )),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  lease_owner TEXT,
  lease_expires_at INTEGER CHECK(lease_expires_at>=0),
  encrypted_job_grant TEXT,
  grant_epoch TEXT,
  error_code TEXT,
  next_owner TEXT CHECK(
    next_owner IS NULL OR next_owner IN ('filesystem','gonic','references','verification')
  ),
  stage_changed_at INTEGER NOT NULL CHECK(stage_changed_at>=0),
  source_device TEXT,
  source_inode TEXT,
  source_digest TEXT CHECK(source_digest IS NULL OR length(source_digest)=64),
  source_mode INTEGER CHECK(source_mode IS NULL OR (source_mode>=0 AND source_mode<=4095)),
  source_uid INTEGER CHECK(source_uid IS NULL OR source_uid>=0),
  source_gid INTEGER CHECK(source_gid IS NULL OR source_gid>=0),
  target_parent_device TEXT,
  target_parent_inode TEXT,
  CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL)),
  CHECK((encrypted_job_grant IS NULL)=(grant_epoch IS NULL)),
  CHECK(stage NOT IN ('failed','conflict','recovery_required') OR error_code IS NOT NULL),
  CHECK(stage<>'succeeded' OR (error_code IS NULL AND new_track_id IS NOT NULL))
) STRICT;

INSERT INTO organization_items_v27 (
  id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,
  audio_identity,baseline_json,stage,generation,lease_owner,lease_expires_at,
  encrypted_job_grant,grant_epoch,error_code,next_owner,stage_changed_at,source_device,
  source_inode,source_digest,source_mode,source_uid,source_gid,target_parent_device,
  target_parent_inode
)
SELECT
  id,job_id,media_link_id,source_key,target_key,old_track_id,new_track_id,file_identity,
  audio_identity,baseline_json,stage,generation,lease_owner,lease_expires_at,
  encrypted_job_grant,grant_epoch,error_code,next_owner,stage_changed_at,source_device,
  source_inode,source_digest,source_mode,source_uid,source_gid,target_parent_device,
  target_parent_inode
FROM organization_items;

DROP TABLE organization_items;
ALTER TABLE organization_items_v27 RENAME TO organization_items;
CREATE INDEX organization_items_runnable
ON organization_items(stage,stage_changed_at,id);

PRAGMA user_version=27;
