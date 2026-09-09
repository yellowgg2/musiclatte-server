CREATE TABLE media_publications (
 file_identity TEXT PRIMARY KEY CHECK(length(file_identity)=64), generation INTEGER NOT NULL CHECK(generation>0),
 owner TEXT NOT NULL, dirty INTEGER NOT NULL CHECK(dirty IN (0,1)), publication_id TEXT,
 digest TEXT CHECK(digest IS NULL OR length(digest)=64), updated_at INTEGER NOT NULL CHECK(updated_at>=0)
) STRICT;
CREATE INDEX media_publications_dirty ON media_publications(dirty,updated_at);
PRAGMA user_version=18;
