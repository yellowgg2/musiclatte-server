DROP INDEX curation_missing;

CREATE TABLE curation_field_states_next (
 track_ref TEXT NOT NULL REFERENCES curation_tracks(id),
 field TEXT NOT NULL CHECK(field IN ('title','artist','album','albumArtist','trackNumber','year','genre','cover','lyrics')),
 status TEXT NOT NULL CHECK(status IN ('unknown','missing','present','unavailable','not_applicable')),
 evidence_revision TEXT, last_attempt_at INTEGER, last_updated_at INTEGER, reason TEXT, source_notes TEXT, actor_ref TEXT,
 value_fingerprint TEXT,
 PRIMARY KEY(track_ref,field), CHECK(status='unknown' OR evidence_revision IS NOT NULL),
 CHECK(status NOT IN ('unavailable','not_applicable') OR (length(reason)>0 AND last_attempt_at IS NOT NULL AND actor_ref IS NOT NULL))
) STRICT;

INSERT INTO curation_field_states_next(
 track_ref,field,status,evidence_revision,last_attempt_at,last_updated_at,reason,source_notes,actor_ref,value_fingerprint
)
SELECT track_ref,field,status,evidence_revision,last_attempt_at,last_updated_at,reason,source_notes,actor_ref,value_fingerprint
FROM curation_field_states;

INSERT INTO curation_field_states_next(track_ref,field,status)
SELECT tracks.id, fields.field, 'unknown'
FROM curation_tracks AS tracks
CROSS JOIN (
 SELECT 'albumArtist' AS field
 UNION ALL SELECT 'trackNumber'
 UNION ALL SELECT 'year'
 UNION ALL SELECT 'genre'
) AS fields;

DROP TABLE curation_field_states;
ALTER TABLE curation_field_states_next RENAME TO curation_field_states;
CREATE INDEX curation_missing ON curation_field_states(field,status,track_ref);

PRAGMA user_version=22;
