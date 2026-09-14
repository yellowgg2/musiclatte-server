# Phase 17 Step 08 verification

## Result

- Corrected `readOrganizationStatuses` so a succeeded non-imported MediaLink can be verified from
  its organization item, current track/path/policy binding, and metadata watermark without an
  `organization_source_locations` row.
- Projected the first qualifying `registering`, `ready`, or `duplicate` import source in the same
  bounded status query. Imported media still fails closed when its source location is absent or its
  source ID, managed key, or organization item does not match.
- Preserved input order, allowed-library scoping, latest-item tie breaking, public state/reason
  enums, response redaction, and the existing MetadataAction presentation.
- Kept schema version 29. No migration, production write, provenance backfill, or synthetic source
  ID was introduced.

## TDD evidence

- Runtime: Node `v24.20.0`, npm `11.19.0`.
- RED: the two focused unit files collected 32 tests; the new storage and API legacy assertions
  failed with `unknown / verification_missing` before the projection change.
- GREEN/refactor: the same two focused unit files passed 32/32 tests. Storage fixtures cover
  non-imported success, non-qualifying import state, all three qualifying import stages, missing
  source location, matching provenance, and mismatched source ID/key/item.
- Public contract: `tests/contract/metadata-organization-api.test.ts` passed 9/9 tests.
- Existing web presentation: `apps/web/test/metadata-single-ui.test.tsx` passed 14/14 tests; jsdom
  emitted only its existing unimplemented media/scroll method notices.
- `npm run typecheck` and `npm run build` passed. The build retained only the existing Vite
  large-chunk warning.

## Production rollout

- Deployed exact `main` commit `2b46ba030f8c8e9630ea02d605fbab6d3eb5caca` to Unraid with the
  seven documented Compose overlays.
- Before recreation, an online SQLite backup plus import, metadata, and automation policy snapshots
  were stored owner-only under
  `/mnt/user/appdata/musiclatte-server-private/backups/phase-17-step-08-20260914-092032`.
- The pre-deploy aggregate was 230 latest succeeded rows, 230 common eligible rows, 230 eligible
  non-import rows, zero qualifying import rows, and zero source-location rows. Schema was 29.
- After deployment, the 230 eligible tracks were queried through the production PAT status endpoint
  in three bounded batches. All 230 returned `organized / verified`, with exact input order.
- Post-deploy aggregate and row counts were unchanged: 231 organization items, zero source
  locations, zero import items, and schema 29. No backfill, metadata job, organization job, or music
  file write was performed.
- API, web, worker, metadata-worker, and Gonic health checks passed. Gateway live/readiness returned
  200; a temporary browser session verified random-library access and a 1,024-byte Range response
  with status 206, `Accept-Ranges`, and `Content-Range`. Scan, import, organization, saved mixes,
  listening history, stream quality, and artist-info capabilities remained available; scrobbling
  stayed enabled and session max age remained 2,592,000 seconds.

Final visual and cross-route user acceptance remains pending in `P17-UA-001–002`.
