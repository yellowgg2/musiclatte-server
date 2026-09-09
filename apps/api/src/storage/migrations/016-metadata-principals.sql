CREATE TABLE metadata_items_v16 (
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
  actor_session_id TEXT REFERENCES sessions(id_hash),
  actor_token_id TEXT REFERENCES access_tokens(id),
  encrypted_job_grant TEXT,
  grant_epoch TEXT,
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
  next_reflection_at INTEGER NOT NULL DEFAULT 0 CHECK(next_reflection_at>=0),
  CHECK((actor_session_id IS NULL) <> (actor_token_id IS NULL)),
  CHECK(actor_token_id IS NOT NULL OR (encrypted_job_grant IS NULL AND grant_epoch IS NULL)),
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

INSERT INTO metadata_items_v16(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,policy_revision,parent_item_id,restore_backup_id,stage,generation,stage_changed_at,file_saved_at,reflected_at,result_revision,result_digest,candidate_key,error_code,changed_fields_json,next_reflection_at) SELECT id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,policy_revision,parent_item_id,restore_backup_id,stage,generation,stage_changed_at,file_saved_at,reflected_at,result_revision,result_digest,candidate_key,error_code,changed_fields_json,next_reflection_at FROM metadata_items;
DROP TABLE metadata_items;
ALTER TABLE metadata_items_v16 RENAME TO metadata_items;
CREATE INDEX metadata_items_runnable ON metadata_items(stage,stage_changed_at,id);
CREATE INDEX metadata_items_file ON metadata_items(file_identity,stage,id);
ALTER TABLE metadata_cover_uploads ADD COLUMN actor_token_id TEXT REFERENCES access_tokens(id);
CREATE TRIGGER metadata_grant_terminal AFTER UPDATE OF stage ON metadata_items
WHEN NEW.stage IN ('succeeded','failed','conflict') AND NEW.encrypted_job_grant IS NOT NULL
BEGIN
  UPDATE metadata_items SET encrypted_job_grant=NULL WHERE id=NEW.id;
END;
PRAGMA user_version=16;
