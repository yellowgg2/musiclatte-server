# Phase 15 Step 00 verification

- Added PAT-only reference snapshot and restore endpoints under metadata organization.
- Restore is limited to the authenticated account and requires an exact successful
  `oldTrackId` to `newTrackId` organization relation recorded by the server.
- Exact favorite state, owned-playlist metadata, duplicate occurrences, order, and authenticated
  readback are enforced; concurrent edits fail closed.
- The operator client stores private per-account snapshots, restores them through the dedicated
  endpoint, and can adopt one verified shared successor in an untouched favorites batch item.
- Existing v1/v2 batch journal terminal records remain decodable.

## Automated evidence

- `npm run test:contract -- tests/contract/id3-organize-batch.test.ts tests/contract/id3-organize-client.test.ts tests/contract/id3-organize-reference-guard.test.ts` — 34 passed.
- `npm run test:unit -- apps/api/test/metadata-organization-api.test.ts apps/api/test/reference-migration.test.ts` — 19 passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; the existing web chunk-size advisory remains non-blocking.
- `npm run format:check` — passed.
- `git diff --check` — passed.
- Skill Creator `quick_validate.py` for `musiclatte-id3-organize` — passed.

Private PATs, account payloads, media paths, manifests, and runtime journals are excluded from this
artifact and from Git.
