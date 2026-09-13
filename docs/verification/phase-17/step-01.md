# Phase 17 Step 01 verification

## Result

- Added schema migration 028 with `organization_items_status_lookup(media_link_id, stage_changed_at DESC, id DESC)`.
- Added one bounded, parameterized repository query for up to 100 track or media-link targets. Results are restored positionally to the original target order.
- Restricted identity resolution to current available media links in allowed libraries. Optional sweep validation also requires a non-tombstoned, verified curation row whose track, media link, and binding revision match the current link.
- Reused the Step 00 public mapper for lifecycle, binding, source-location, policy, and metadata-freshness decisions. The path-driving field set is centralized as `title`, `album`, `albumArtist`, `artist`, and `trackNumber`.
- Missing source-location or metadata watermark evidence yields `unknown`; a proven binding or policy mismatch yields `needs_organization`.

## Query plan

The fixture database's `EXPLAIN QUERY PLAN` for the deterministic latest-item lookup reports `organization_items_status_lookup`. The existing `organization_items_runnable` worker index remains present and unchanged.

## TDD evidence

- Runtime: Node `v24.20.0`, npm `11.19.0`.
- RED: `npm run test:unit -- apps/api/test/organization-storage.test.ts` collected 14 tests and failed the 4 new tests because `readOrganizationStatuses` and migration 028 were absent.
- GREEN: `npm run test:unit -- apps/api/test/organization-storage.test.ts apps/api/test/organization-state.test.ts` passed 18/18 tests.
- Focused curation storage: 5/5 passed.
- Focused metadata organization API regression: 12/12 passed.
- Migration and backup/restore regression set: 11 files, 145/145 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check`: passed.

No HTTP route, web UI, deployment, production database, or music files were changed.
