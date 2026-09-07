# Phase 4 Step 06 — Metadata API and capabilities

Implemented 2026-09-08 from `2214f29` on
`yellowgg2/tdd/phase-4/step-06-metadata-api-capabilities`.

Initial RED: two intended 404-versus-200 failures for absent actual-read and preview/submit
routes. The change-feed test then failed for its absent endpoint. A real regression test showed
that a mismatch-to-verified receipt was not observable through a previous cursor; event status
updates now advance sequence. A separate real-image test failed 200-versus-422 after replacing
an uploaded PNG with a different valid PNG; the helper now checks the recorded upload digest.
These failures were fixed at their owning boundaries, without weakening assertions.

## Verified behavior

- Actual synthetic ID3 tags differ from the indexed title; non-editors can read but not submit.
- In-memory preview leaves music bytes/directory entries, backups and job counts unchanged.
- Fresh/stale revisions, duplicate targets, cross-library targets, long opaque IDs, unknown
  body/query properties, malformed date/track values and Origin/CSRF are enforced.
- Accepted operations replay before worker/file availability, and changed valid bodies conflict.
- Owner-only history, cursor pagination, failed-only child retry, durable no-write recheck and
  administrator/manager scoped restore enqueue use the real SQLite repository.
- Raw PNG decode, exact embedded preview, principal-bound frame handles and private upload
  previews are verified. Cross-account upload consumption returns 404 even for another editor.
- Invalid images, >8 MiB bodies and altered stored image digests are rejected. The ordinary
  session route retains its 16 KiB JSON limit. Consumed uploads survive expiry; only expired
  unreferenced uploads are deleted.
- Changes start with a bounded latest-managed-file snapshot and continue through scoped signed
  cursors without upstream directory scans. Identity and policy changes invalidate cursors.
- Reflection mismatch and verified receipts remain distinct. Fresh cover requests discard old
  browser validators and do not forward revision to gonic. Legacy media transport tests pass.
- Producer permission intersects current gonic folders. Exact write profile plus non-future
  fresh worker heartbeat is required; version output alone and stale heartbeats do not suffice.
- Strict independent decoders cover preview, upload, changes, partial saved results and optional
  capability descriptors. Web metadata, curation and automation consumers remain disabled.

The HTTP tests generate short sine MP3s, original synthetic lyrics and raster images using the
existing S03 fixture generator and pinned local toolchain. Receipt-only HTTP recovery cases seed
synthetic ledger receipts; they are enqueue/permission tests, not a claim of new live disk
restoration. S04 owns the actual file/restore proof and S05 owns real gonic reflection. No real
music, personal tags, credentials, binaries, or runtime data are committed. No remote service
was changed in S06. S07 owns full API/worker runtime and isolated deployment validation.

## Final gates

All commands ran from the code repository with session-local Node 24.20.0/npm 11.19.0.
Local helper execution uses the S03 pinned Mutagen 1.48.1 / Python 3.11.15 / FFmpeg 9.0.1 tools.

- `npm run format` before verification.
- Unit: metadata-api, auth-api, media-proxy, metadata-helper/storage/worker/reflection/boundaries,
  session-storage, engine-requests, import-storage/worker, gonic-registration: **193 passed**,
  **13 files**, zero skipped tests. The metadata API suite contains 10 tests.
- Contract: metadata-api, capabilities, media-transport, metadata-schema: **36 passed**,
  **4 files**, zero skipped tests.
- `npm run typecheck` and `npm run build`: exit 0.
- Final formatting and staged diff checks run at the separate Git handoff.

Additive schema v11 stores recheck idempotency. Existing v7/v8 migration fixtures, table
inventories, database backup validation and import/session behavior pass. The API registers its
related endpoints in one module to share guards; private service, cover, changes and runtime
configuration modules remain separate. No UI/locale/Gallery change or UI review debt.

Rulebook lookup selected no directly applicable new lesson; postflight
`skipped(no_new_lesson)`, no central write/sync. The retained gonic v0.22.0 warmed-cover limitation
is documented in [metadata-api](../../../architecture/metadata-api.md). It is not advertised as
immediate cover reflection or worked around by changing sizes. S08–S11 must retain the saved vs
reflected distinction. S07 and all later steps remain pending at this handoff.
