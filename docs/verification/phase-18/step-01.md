# Phase 18 Step 01 — External recent-watch storage

Implementation uses schema v31 because schema v30 was already assigned to organization target
replacement recovery before this Step began.

## Result

- Rebuilt `download_events` with a direct `media_link_id`, strict `musiclatte|external` provenance,
  and nullable import binding while preserving historical rowids.
- Added exact account-owner projections, durable watch roots, path-once file observations, bounded
  runnable indexes, and reclaimable leases.
- Updated both import publication paths to record the direct MediaLink explicitly.
- Backup validation covers the new ledgers; offline restore preserves observations while releasing
  process-owned leases and incrementing generations.

## Verification

- RED: `apps/api/test/import-storage.test.ts` failed 2/10 on expected schema v31 and missing watch
  tables.
- RED: `apps/api/test/external-watch-storage.test.ts` failed 2/2 because the repository export was
  absent.
- Unit: five focused files passed 78/78, covering real v30→v31 migration, rowid gaps 7/42, storage
  constraints, lease reopen/reclaim, backup/restore, recent API behavior, and import publication.
- Contract: `tests/contract/recent-downloads-api.test.ts` passed 2/2.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.
- Existing recent query-plan coverage confirms `download_events_recent` remains the bounded range
  index and no `import_items` join remains in the query.

No external filesystem discovery, event admission, Gonic registration, worker scheduling, UI,
locale, or production deployment was added in this Step.
