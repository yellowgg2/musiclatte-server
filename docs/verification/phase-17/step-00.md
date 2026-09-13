# Phase 17 Step 00 verification

## Result

- Added the public `OrganizationState` and bounded reason contract without changing the existing worker lifecycle or collection selection contracts.
- Added strict bulk status request/response decoders and JSON schemas for 1–100 unique track or media-link targets.
- Added an exhaustive pure mapping from every organization lifecycle stage plus succeeded freshness facts to one public state/reason pair. `moved` remains `processing`; only verified `succeeded` can be `organized`.
- Added a synthetic five-state fixture with no credentials, filesystem paths, or personal metadata.

## Public JSON example

```json
{
  "schemaVersion": 1,
  "capturedAt": 1000,
  "items": [
    {
      "target": { "kind": "track", "trackId": "track-1" },
      "state": "organized",
      "reason": "verified",
      "stage": "succeeded",
      "changedAt": 900
    }
  ]
}
```

The public shape cannot represent actor/session/token IDs, source or target paths, source evidence, or raw error details.

## TDD evidence

- Runtime: Node `v24.20.0`, npm `11.19.0` from the project-local toolchain.
- RED: `npm run test:contract -- tests/contract/metadata-organization-api.test.ts` collected 8 tests and failed the 2 new tests because the status decoders and mapping function were absent.
- GREEN: the same focused contract command passed 8/8 tests.
- `npm run typecheck`: passed for the root and all four workspaces.
- `npm run build`: passed for contracts, test-support, API, and web.
- `npm run format:check`: passed.
- `git diff --check`: passed.

No UI, API route, storage schema, deployment, or music files changed in this Step.
