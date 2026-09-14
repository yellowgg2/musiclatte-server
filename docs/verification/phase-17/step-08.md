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

## Rollout boundary

The production observation used to define this fix was aggregate-only: 230 latest succeeded rows
matched the current track/path/policy/watermark evidence, had no qualifying import provenance, and
had no source-location row. This TDD cycle did not reconnect to production, deploy, modify its
database, create jobs, or touch music files. The pre-deploy aggregate refresh, private backup,
deployment, post-deploy status convergence, row-count invariance, health checks, and final UI
acceptance remain separate authorized work.
