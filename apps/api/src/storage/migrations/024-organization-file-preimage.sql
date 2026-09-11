ALTER TABLE organization_items ADD COLUMN source_device TEXT;
ALTER TABLE organization_items ADD COLUMN source_inode TEXT;
ALTER TABLE organization_items ADD COLUMN source_digest TEXT CHECK(source_digest IS NULL OR length(source_digest)=64);
ALTER TABLE organization_items ADD COLUMN source_mode INTEGER CHECK(source_mode IS NULL OR (source_mode>=0 AND source_mode<=4095));
ALTER TABLE organization_items ADD COLUMN source_uid INTEGER CHECK(source_uid IS NULL OR source_uid>=0);
ALTER TABLE organization_items ADD COLUMN source_gid INTEGER CHECK(source_gid IS NULL OR source_gid>=0);
ALTER TABLE organization_items ADD COLUMN target_parent_device TEXT;
ALTER TABLE organization_items ADD COLUMN target_parent_inode TEXT;
PRAGMA user_version=24;
