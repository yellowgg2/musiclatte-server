ALTER TABLE curation_tracks ADD COLUMN tombstoned INTEGER NOT NULL DEFAULT 0 CHECK(tombstoned IN (0,1));
ALTER TABLE curation_tracks ADD COLUMN source_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE curation_field_states ADD COLUMN value_fingerprint TEXT;
CREATE TABLE curation_source_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, library_id TEXT NOT NULL, media_link_id TEXT REFERENCES media_links(id),
 track_id TEXT, kind TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX curation_source_library ON curation_source_events(library_id,sequence);
CREATE TRIGGER curation_import_published AFTER UPDATE OF stage ON import_items WHEN NEW.stage='registering' AND OLD.stage='publishing' BEGIN
 INSERT INTO curation_source_events(library_id,media_link_id,track_id,kind,source_key,created_at)
 SELECT e.library_id,NEW.media_link_id,m.gonic_song_id,'import_published','import:'||e.id,e.download_completed_at FROM download_events e JOIN media_links m ON m.id=NEW.media_link_id WHERE e.import_item_id=NEW.id;
END;
CREATE TRIGGER curation_import_registered AFTER UPDATE OF registered_at ON download_events WHEN NEW.registered_at IS NOT NULL AND OLD.registered_at IS NULL BEGIN
 INSERT INTO curation_source_events(library_id,media_link_id,track_id,kind,source_key,created_at)
 SELECT NEW.library_id,i.media_link_id,m.gonic_song_id,'import_registered','registered:'||NEW.id,NEW.registered_at FROM import_items i JOIN media_links m ON m.id=i.media_link_id WHERE i.id=NEW.import_item_id;
END;
CREATE TRIGGER curation_metadata_stage AFTER UPDATE OF stage ON metadata_items WHEN NEW.stage IN ('file_saved','succeeded') AND NEW.stage!=OLD.stage BEGIN
 INSERT OR IGNORE INTO curation_source_events(library_id,media_link_id,track_id,kind,source_key,created_at)
 SELECT j.library_id,NEW.media_link_id,NEW.current_track_id,'metadata_'||NEW.stage,'metadata:'||NEW.id||':'||NEW.stage,NEW.stage_changed_at FROM metadata_jobs j WHERE j.id=NEW.job_id;
END;
PRAGMA user_version=19;
