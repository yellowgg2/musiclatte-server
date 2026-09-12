# Phase 12 Step 01 verification

## Scope

- Added required `identityResolution` to the schema-version-1 metadata change type and JSON schema.
- Added decoder validation for all four values, old/new ID invariants, and the forbidden
  `reference_conflict + replacement_verified` combination.
- Projected the current same-MediaLink organization ledger into every accessible snapshot/delta
  response without exposing private organization data.

## TDD evidence

- RED unit: `metadata-api.test.ts` collected 12 tests and failed the expected missing-field
  assertion.
- RED contract: `metadata-api.test.ts` collected 4 tests and rejected the new strict key before
  the contract implementation.
- GREEN unit: metadata API, organization API, and identity projection passed 39 tests across 3
  files.
- GREEN contract: metadata API and organization API passed 10 tests across 2 files.
- Consumer regression: web metadata state and integration passed 11 tests across 2 files. Typed
  and runtime verification fixtures now emit the required additive field.
- Static/build gates: workspace typecheck, production build, Prettier check, and `git diff --check`
  passed.

The organization API scenario covers unrelated-MediaLink isolation, unresolved snapshot,
increasing pending/verified cursor deltas, restart-equivalent verified snapshot,
`reflection_mismatch` preservation, decoder round-trip, and private job/item/path/evidence absence.
The web integration assertion reads selection state directly after an empty refreshed page, because
the selection toolbar is intentionally not rendered with empty contents.
