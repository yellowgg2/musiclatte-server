CREATE TABLE curation_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), claim_epoch TEXT NOT NULL CHECK(length(claim_epoch)=64)
) STRICT;
INSERT INTO curation_state VALUES(1,lower(hex(randomblob(32))));
CREATE TABLE curation_tracks (
 id TEXT PRIMARY KEY, library_id TEXT NOT NULL, track_id TEXT NOT NULL,
 media_link_id TEXT REFERENCES media_links(id), file_identity TEXT, binding_revision INTEGER,
 format TEXT NOT NULL CHECK(format IN ('mp3','unsupported')),
 title TEXT, artist_json TEXT NOT NULL CHECK(json_valid(artist_json)),
 base_status TEXT NOT NULL CHECK(base_status IN ('unreviewed','needs_review','completed')),
 revision TEXT, required_fingerprint TEXT, audio_identity TEXT, policy_version TEXT NOT NULL,
 receipt_id TEXT REFERENCES curation_receipts(id), validation TEXT NOT NULL CHECK(validation IN ('unknown','verified','pending','stale')),
 last_verified_at INTEGER, UNIQUE(library_id,track_id),
 CHECK(base_status!='completed' OR receipt_id IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX curation_file ON curation_tracks(file_identity) WHERE file_identity IS NOT NULL;
CREATE INDEX curation_selection ON curation_tracks(library_id,track_id,base_status,format);
CREATE TABLE curation_field_states (
 track_ref TEXT NOT NULL REFERENCES curation_tracks(id), field TEXT NOT NULL CHECK(field IN ('title','artist','album','cover','lyrics')),
 status TEXT NOT NULL CHECK(status IN ('unknown','missing','present','unavailable','not_applicable')),
 evidence_revision TEXT, last_attempt_at INTEGER, last_updated_at INTEGER, reason TEXT, source_notes TEXT, actor_ref TEXT,
 PRIMARY KEY(track_ref,field), CHECK(status='unknown' OR evidence_revision IS NOT NULL),
 CHECK(status NOT IN ('unavailable','not_applicable') OR (length(reason)>0 AND last_attempt_at IS NOT NULL AND actor_ref IS NOT NULL))
) STRICT;
CREATE INDEX curation_missing ON curation_field_states(field,status,track_ref);
CREATE TABLE curation_receipts (
 id TEXT PRIMARY KEY, track_ref TEXT NOT NULL REFERENCES curation_tracks(id), file_identity TEXT NOT NULL,
 actor_json TEXT NOT NULL CHECK(json_valid(actor_json)), completed_at INTEGER NOT NULL CHECK(completed_at>=0),
 verified_revision TEXT NOT NULL, required_fingerprint TEXT NOT NULL, audio_identity TEXT NOT NULL,
 policy_version TEXT NOT NULL, source_notes TEXT
) STRICT;
CREATE TRIGGER curation_receipts_no_update BEFORE UPDATE ON curation_receipts BEGIN SELECT RAISE(ABORT,'append-only receipt'); END;
CREATE TRIGGER curation_receipts_no_delete BEFORE DELETE ON curation_receipts BEGIN SELECT RAISE(ABORT,'append-only receipt'); END;
CREATE TABLE curation_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, track_ref TEXT NOT NULL REFERENCES curation_tracks(id),
 event_key TEXT UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;
CREATE INDEX curation_history ON curation_events(track_ref,sequence);
CREATE TRIGGER curation_events_no_update BEFORE UPDATE ON curation_events BEGIN SELECT RAISE(ABORT,'append-only event'); END;
CREATE TRIGGER curation_events_no_delete BEFORE DELETE ON curation_events BEGIN SELECT RAISE(ABORT,'append-only event'); END;
CREATE TABLE curation_claims (
 id TEXT PRIMARY KEY, actor_key TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('required_review','optional_enrichment')),
 fields_json TEXT NOT NULL CHECK(json_valid(fields_json)), generation INTEGER NOT NULL CHECK(generation>0),
 claim_epoch TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, released_at INTEGER,
 CHECK(lease_until>created_at)
) STRICT;
CREATE TABLE curation_claim_items (
 claim_id TEXT NOT NULL REFERENCES curation_claims(id), track_ref TEXT NOT NULL REFERENCES curation_tracks(id),
 file_identity TEXT NOT NULL, binding_revision INTEGER NOT NULL, expected_revision TEXT NOT NULL,
 PRIMARY KEY(claim_id,track_ref)
) STRICT;
CREATE INDEX curation_claim_file ON curation_claim_items(file_identity,claim_id);
CREATE TABLE curation_operations (
 actor_key TEXT NOT NULL, route TEXT NOT NULL, operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 admission_results_json TEXT NOT NULL CHECK(json_valid(admission_results_json)), created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_key,route,operation_hash)
) STRICT;
CREATE TABLE curation_inventory_runs (
 library_id TEXT PRIMARY KEY, generation TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('discovering','partial','ready','stale','error')),
 last_discovery_at INTEGER, last_reconciled_at INTEGER, last_error_code TEXT,
 event_sequence INTEGER NOT NULL DEFAULT 0, checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json))
) STRICT;
CREATE TABLE curation_inventory_queue (
 library_id TEXT NOT NULL REFERENCES curation_inventory_runs(library_id), generation TEXT NOT NULL, opaque_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('directory','track')), status TEXT NOT NULL CHECK(status IN ('pending','done','error')),
 PRIMARY KEY(library_id,generation,kind,opaque_id)
) STRICT;
CREATE INDEX curation_inventory_pending ON curation_inventory_queue(library_id,generation,status);
CREATE TABLE curation_snapshots (
 id TEXT PRIMARY KEY, scope_hash TEXT NOT NULL, filter_hash TEXT NOT NULL, as_of INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>as_of), total INTEGER NOT NULL CHECK(total>=0), coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json))
) STRICT;
CREATE INDEX curation_snapshot_expiry ON curation_snapshots(expires_at);
CREATE TABLE curation_snapshot_items (
 snapshot_id TEXT NOT NULL REFERENCES curation_snapshots(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal>=0), projection_json TEXT NOT NULL CHECK(json_valid(projection_json)), PRIMARY KEY(snapshot_id,ordinal)
) STRICT;
PRAGMA user_version=17;
