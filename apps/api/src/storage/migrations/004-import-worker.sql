CREATE TABLE media_links_v4 (
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
  gonic_song_id TEXT CHECK (gonic_song_id IS NULL OR length(gonic_song_id) > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'unavailable')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  validated_at INTEGER CHECK (validated_at IS NULL OR validated_at >= created_at),
  CHECK (gonic_song_id IS NOT NULL OR availability = 'unavailable'),
  UNIQUE (library_id, relative_file_key),
  UNIQUE (library_id, gonic_song_id)
) STRICT;

INSERT INTO media_links_v4 SELECT * FROM media_links;
DROP TABLE media_links;
ALTER TABLE media_links_v4 RENAME TO media_links;

CREATE TABLE import_publish_intents (
  item_id TEXT PRIMARY KEY REFERENCES import_items(id),
  relative_file_key TEXT NOT NULL,
  staging_key TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  media_link_id TEXT NOT NULL UNIQUE,
  intended_at INTEGER NOT NULL CHECK (intended_at >= 0),
  pending_device INTEGER,
  pending_inode INTEGER,
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= intended_at),
  disposition TEXT NOT NULL CHECK (disposition IN ('new', 'duplicate'))
) STRICT;
CREATE TABLE import_attempts (
  item_id TEXT NOT NULL REFERENCES import_items(id),
  attempt INTEGER NOT NULL,
  staging_key TEXT NOT NULL UNIQUE,
  engine_version TEXT,
  started_at INTEGER NOT NULL,
  cleaned_at INTEGER CHECK (cleaned_at IS NULL OR cleaned_at >= started_at),
  PRIMARY KEY(item_id, attempt)
) STRICT;
CREATE INDEX import_attempts_cleanup ON import_attempts(item_id) WHERE cleaned_at IS NULL;
PRAGMA user_version = 4;
