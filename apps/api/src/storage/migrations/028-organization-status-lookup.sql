CREATE INDEX organization_items_status_lookup
ON organization_items(media_link_id, stage_changed_at DESC, id DESC);

PRAGMA user_version=28;
