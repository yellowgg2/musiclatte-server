# Phase 6 Step 10 — Automation runtime

The optional overlay wires the API, metadata worker and import worker to one private OS fence
volume and one strict automation policy. API music stays read-only; worker credentials and
metadata backup data are not mounted into the API. P3 uses the instance key to derive the same
file identity as P4. The initializer rejects differing writer UID/GID values.

The metadata scheduler performs recovery, file writes, reflection, then a bounded inventory turn.
Parent abort leaves unfinished discovery checkpointed; restart resumes it, and restored stale
inventory starts revalidation immediately. Capability availability follows real worker heartbeat
and inventory state. Baseline installations remain opt-out.

`automation-http-client.ts` is a source-only actual HTTP consumer with private config/credentials,
one-time in-memory PATs, partial admission, response replay, explicit completion, optional lyric
set/clear and unavailable evidence, claim cleanup and revocation. A fully rejected busy-file
admission retries with a new operation; uncertain accepted requests replay the same operation.
`automation-runtime-probe.ts` additionally enforces an isolated Linux project/fixture ownership
marker, bounded Docker calls and named helper cleanup. It checks worker stop/restart, observed
pre-publication SIGKILL recovery, exact original bytes, legacy metadata edit, `/rest` read and
100-byte Range, matching offline snapshots into new volumes, preserved sessions, revoked PATs,
invalid token cursors/claim epochs and inventory revalidation.

RED/GREEN: strict automation config and scheduler turn tests initially failed before wiring;
producer/web/API radio URL regressions are recorded separately. The source-only consumer's
actual route/MP3 contract uncovered missing JSON on cookie DELETE and now passes. The isolated
read-only snapshot mount exposed retained WAL/SHM sidecars: the backup producer now checkpoints
and seals the new snapshot in DELETE journal mode. A regression requiring only the database/key
files failed before that change; 22 token/session/metadata backup tests pass afterward. Existing
WAL-aware restore behavior and live data are preserved.

Automated checks: runtime/inventory/metadata runtime unit tests (8), media fence and token storage
(6), affected backup tests (22), runtime HTTP/roundtrip/deployment contracts (4), typecheck, build
and format check. The live probe uses only a new `/tmp/musiclatte-p6-*` workspace, dedicated Compose
project, loopback ports and a two-second generated sine-wave MP3. Existing gonic and P5 acceptance
services are untouched. On 2026-09-09 the runtime probe passed all reported checks on the isolated Debian container stack, and the standalone HTTP client subsequently passed issuance→write→completion→optional lyrics→revocation. The source-only client waits for actual worker availability after restart. The read-only snapshot/new-volume restore passed after artifact sealing. Owned resource cleanup and overlay rollback are verified before Git handoff.

P6-UA-007 remains pending: judging an external agent's information quality is optional user
acceptance. The deterministic HTTP/runtime checks are implementation evidence, not that acceptance.
Rulebook postflight: skipped (no new shared lesson selected).
