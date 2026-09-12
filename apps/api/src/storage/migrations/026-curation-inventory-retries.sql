ALTER TABLE curation_inventory_queue
ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0);
ALTER TABLE curation_inventory_queue
ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE curation_inventory_queue
ADD COLUMN last_error_code TEXT;
ALTER TABLE curation_inventory_queue
ADD COLUMN terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1));

CREATE INDEX curation_inventory_retry
ON curation_inventory_queue(library_id,generation,status,terminal,next_attempt_at);

CREATE TABLE curation_inventory_failures (
 library_id TEXT NOT NULL REFERENCES curation_inventory_runs(library_id),
 kind TEXT NOT NULL CHECK(kind IN ('directory','track')),
 opaque_id TEXT NOT NULL,
 failure_count INTEGER NOT NULL CHECK(failure_count>=1),
 last_error_code TEXT NOT NULL,
 last_cause TEXT NOT NULL CHECK(last_cause IN ('item_timeout','upstream')),
 first_failed_at INTEGER NOT NULL,
 last_failed_at INTEGER NOT NULL,
 resolved_at INTEGER,
 PRIMARY KEY(library_id,kind,opaque_id)
) STRICT;

PRAGMA user_version=26;
