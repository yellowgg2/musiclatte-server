CREATE TABLE listening_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 identity_key TEXT NOT NULL,
 event_id_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 song_id TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'web' CHECK(source='web'),
 started_at INTEGER NOT NULL CHECK(started_at>=0),
 qualified_at INTEGER NOT NULL CHECK(qualified_at>=started_at),
 received_at INTEGER NOT NULL CHECK(received_at>=0),
 UNIQUE(identity_key,event_id_hash)
) STRICT;
CREATE INDEX listening_history_owner ON listening_events(identity_key,sequence DESC);
CREATE INDEX listening_range_owner ON listening_events(identity_key,qualified_at,sequence,song_id);
CREATE INDEX listening_song_owner ON listening_events(identity_key,song_id,qualified_at DESC,sequence);
CREATE TRIGGER listening_events_no_update BEFORE UPDATE ON listening_events BEGIN SELECT RAISE(ABORT,'Immutable listening event'); END;
CREATE TRIGGER listening_events_no_delete BEFORE DELETE ON listening_events BEGIN SELECT RAISE(ABORT,'Immutable listening event'); END;
CREATE TABLE listening_deliveries (
 event_sequence INTEGER PRIMARY KEY REFERENCES listening_events(sequence),
 status TEXT NOT NULL CHECK(status IN ('not_sent','dispatching','submitted','uncertain','skipped')),
 claimed_at INTEGER CHECK(claimed_at>=0),
 finished_at INTEGER CHECK(finished_at>=0),
 CHECK(
  (status='not_sent' AND claimed_at IS NULL AND finished_at IS NULL) OR
  (status='dispatching' AND claimed_at IS NOT NULL AND finished_at IS NULL) OR
  (status IN ('submitted','uncertain') AND claimed_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at>=claimed_at) OR
  (status='skipped' AND claimed_at IS NULL AND finished_at IS NOT NULL)
 )
) STRICT;
PRAGMA user_version=21;
