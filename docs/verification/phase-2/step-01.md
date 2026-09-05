# Phase 2 Step 01 — Subsonic collection adapter verification

Date: 2026-09-05

## Outcome

Implemented the server-only typed gonic v0.22.0 collection adapter. No BFF route, capability change, management persistence, React/UI, native source, live playlist, or live star state was added or changed.

## Contract evidence

- `packages/contracts/src/collections.ts`: strict playlist summary/detail and ordered starred-song domain types.
- `apps/api/src/subsonic/protocol.ts`: playlist/starred decoders, RFC 3339 timestamps, nonnegative safe-integer counts, omitted `public=false`, and omitted/null list normalization.
- `apps/api/src/subsonic/client.ts`: explicit `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `getStarred2`, `starSong`, and `unstarSong` methods.
- `packages/test-support/src/collection-fixtures.ts`: synthetic source-shaped collection fixture. The default fake remains read-only; collection mutations require the explicit `collections` scenario.
- Source mapping was checked against gonic v0.22.0 `handlers_playlist.go`, `handlers_by_tags.go`, and `spec/spec.go`: create replacement uses ordered repeated `songId`; update removes positions in descending order before appending `songIdToAdd`; star/unstar use account-scoped set state; playlist JSON omits false `public` and optional entries.

## TDD evidence

- RED unit: `apps/api/test/subsonic-client.test.ts` ran 26 tests; 24 passed and 2 new tests failed because `createPlaylist` was absent.
- RED contract: `tests/contract/subsonic-parity.test.ts` ran 43 tests; 31 passed and 12 new cases failed because collection read methods were absent.
- RED harness: typecheck and build both passed, proving the failures were missing behavior rather than collection/import errors.
- GREEN/REFACTOR focused: unit 30/30 and contract 43/43 passed.
- Covered ordered duplicates and special characters, create/replace/update pair order, nonnegative removal indexes, empty and null lists, unknown-field projection, malformed owner/date/count/entry, standard errors 10/40/41/50/70, HTTP/HTML/timeout/cancel sanitization, and default fake write rejection.

## Commands

All commands used Node 24.20.0 and npm 11.19.0 from the pinned session-local toolchain.

```text
npm run format
npm run test:unit -- apps/api/test/subsonic-client.test.ts
npm run test:contract -- tests/contract/subsonic-parity.test.ts
npm run typecheck
npm run build
npm run format:check
```

Final gate: 17 unit files with 212 tests passed, 10 contract files with 104 tests passed, typecheck passed, build passed, and format-check passed.

## Residual ownership

- Phase 2 Step 03 owns playlist BFF reads and `playlists.read` capability.
- Phase 2 Step 04 owns mutation authorization, receipts, reconciliation, and `playlists.write`.
- Phase 2 Step 05 owns favorite BFF reconciliation and `favorites.songs`.
- Phase 2 Step 11 owns live devserver and Musiclatte round-trip mutation verification.

Rulebook postflight: `skipped(no_new_lesson)`. The implementation produced no repeated, high-cost failure meeting the 3×HIGH capture threshold; no canonical write or Rulebook data-repo sync was required.
