CREATE TABLE organization_identity_publications (
  item_id TEXT NOT NULL REFERENCES organization_items(id),
  resolution TEXT NOT NULL CHECK(resolution IN ('replacement_pending','replacement_verified')),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(item_id,resolution)
) STRICT;
CREATE TRIGGER organization_identity_publications_no_update BEFORE UPDATE ON organization_identity_publications BEGIN SELECT RAISE(ABORT,'append-only identity publication'); END;
CREATE TRIGGER organization_identity_publications_no_delete BEFORE DELETE ON organization_identity_publications BEGIN SELECT RAISE(ABORT,'append-only identity publication'); END;
PRAGMA user_version=25;
