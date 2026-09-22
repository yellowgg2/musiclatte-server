UPDATE curation_inventory_failures AS failure
SET resolved_at = COALESCE(
  (
    SELECT run.last_reconciled_at
    FROM curation_inventory_runs AS run
    WHERE run.library_id = failure.library_id
  ),
  failure.last_failed_at
)
WHERE failure.resolved_at IS NULL
  AND failure.kind = 'track'
  AND EXISTS (
    SELECT 1
    FROM curation_tracks AS track
    WHERE track.library_id = failure.library_id
      AND track.track_id = failure.opaque_id
      AND track.tombstoned = 1
  );

UPDATE curation_inventory_failures AS failure
SET resolved_at = COALESCE(
  (
    SELECT run.last_reconciled_at
    FROM curation_inventory_runs AS run
    WHERE run.library_id = failure.library_id
  ),
  failure.last_failed_at
)
WHERE failure.resolved_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM curation_inventory_runs AS run
    WHERE run.library_id = failure.library_id
      AND run.status = 'ready'
      AND NOT EXISTS (
        SELECT 1
        FROM curation_inventory_queue AS queue
        WHERE queue.library_id = run.library_id
          AND queue.generation = run.generation
          AND queue.kind = failure.kind
          AND queue.opaque_id = failure.opaque_id
      )
  );

PRAGMA user_version=32;
