# Phase 4 S07 — Metadata runtime and isolated deployment

Completed 2026-09-08 on `yellowgg2/tdd/phase-4/step-07-metadata-runtime`, based on S06 `c575ae4`.

The opt-in metadata API/worker image, private volume boundary, fair scheduler, authenticated actor lookup, current-profile self-test, bounded exact cover projection and matching backup/restore are implemented. No web metadata entry point or bulk field advertisement was enabled in this step.

## Verification

Session-local Node 24.20.0 / npm 11.19.0; host global runtimes unchanged.

- Initial RED: metadata runtime 2 assertions and metadata deployment contract 1 assertion failed before their modules/image existed.
- Final affected unit: **134 tests / 11 files passed**, no skips or zero-test filters. Files: metadata-runtime, metadata-backup, backup-restore, deployment-runtime, metadata-worker, session-storage, metadata-api, metadata-reflection, metadata-storage, subsonic-client, gonic-registration.
- Affected contract: **96 tests / 8 files passed**, no skips. Deployment/metadata-deployment/gateway-parity/production-exclusion: 19; metadata-api/metadata-schema/capabilities/subsonic-parity: 77.
- `npm run format`, `npm run typecheck`, `npm run build`, `npm run format:check` passed. The additive ping profile fields are asserted explicitly; public compatibility contracts pass.
- Backup CLI refuses to initialize a missing source database. API rechecks refresh a same-owner actor session only for a new operation; replay retains the original receipt.

## Actual isolated Linux evidence

`ssh devserver` inspection found only the existing gonic-demo service on port 4747 (SSH 42025). Testing used a separate `musiclatte-p4-s07-runtime` project, an owned private run directory, generated 150-second sine-tone MP3 and loopback ports 14847/18080/18081. No real library files or account metadata were copied into this repository. Host Node 22 and Python 3.9 were not replaced; a session-local Node 24 binary executed the probe.

Docker 23.0.2 / Compose 2.17.2; Linux ext4. Image runtime: Node 24.20.0, Python 3.11.2, Mutagen 1.48.1, FFmpeg 5.1.9-0+deb12u1. Gonic profile 0.22.0, pinned manifest `sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49`. Go 1.26.0 builds the static imaging 1.6.2/x-image 0.41.0 cover comparator with verified modules and bundled notices.

Final worker image: `sha256:90c2e5eb0de7b229e75f188a75c901a39a75cb8551cb487e9a82b4483553308d`. API: `sha256:2a75539b7e589635e4618db6035a57bed142dd5c9205a875a1e83527725e2e73`. Combined import worker: `sha256:6195911ac045c691392588d9aff9349cdec17fa685659a5bac54702be652d20a`.

Commands from the isolated source checkout:

```sh
npx tsx tools/verification/metadata-runtime-probe.ts --config "$METADATA_PROBE_CONFIG"
```

A second private config with `combined: true` exercises the combined workers. Credentials, rendered configs and raw private snapshots were retained only in the owned test directory and removed after verification.

Observed results:

1. Actual Compose rendering passed for base-only, imports-only, metadata-only and combined overlays. API/gonic music is read-only; metadata worker music is writable; API has neither metadata-data nor scan credential; no Docker socket mount. A real API write attempt failed with EROFS, and `/metadata-data` was absent from that container.
2. Metadata-only starts without yt-dlp/import engine. Synthetic startup read/prepare/read-back and exact PNG cover projection completed before healthy advertisement. API job submission changed tags, retained the track ID and completed gonic reflection; restore jobs restored indexed metadata.
3. Graceful worker stop preserved API readiness, job access and exact 100-byte HTTP 206 Range playback. Restart became healthy. SIGKILL during an observed preparation stage produced a safely recovered failed item after lease expiry; API retry completed successfully.
4. Matching DB/key/data/uploads snapshots restored into four **new distinct Docker volumes**, then the restored worker completed startup/recovery and became healthy. The first actual attempt exposed EXDEV from cross-volume key rename; exclusive copy plus fsync fixed it. Revalidation passed. The final CLI also created a snapshot from a read-only SQLite connection.
5. Both real import and metadata workers became healthy together. An import-side shared scan lease held metadata in reflecting without changing the gonic title. Releasing the lease allowed verified reflection; a restore job then completed. No external download was required to exercise this coordinator boundary.
6. The real gateway passed native Subsonic ping and 100-byte Range streaming, plus its health endpoint. API/worker images excluded tests/probe tools/private runtime data; Mutagen corresponding source/COPYING and Go/imaging/x-image notices were present.

Machine-readable sanitized observations: [runtime](runtime.json), [combined](combined.json). These contain booleans only, with no identities, file paths or authentication material.

## Scope and limits

The S05 warmed gonic cover cache limitation remains: file save can succeed while reflection reports mismatch. The runtime compares the actual default gonic cover projection; it does not clear shared caches, use an unused size or declare stale bytes verified. New gonic/helper versions need renewed profile evidence. Files outside the exclusive supported POSIX/MP3 profile remain unavailable. Snapshot restoration requires matching current managed music; it does not itself restore the entire gonic database or host music library.

S08 owns web synchronization/playback preservation; S09–S11 own product editing/history UI and device acceptance. No user-device evidence is claimed here.

## Cleanup and postflight

Owned test containers, volumes and networks: **0 remaining**. Owned remote source/runtime/private snapshots/music directory and local temporary synthetic media archive were removed. The existing gonic-demo remained running on 4747; no existing service/volume was changed. Dependency images and the external local toolchain cache may remain as reusable build artifacts; they contain no test account/session data.

Rulebook: reused the active version-alignment safeguard. Postflight candidate `metadata-restore-cross-volume-key-publication`: exact search found no matching rule (unrelated results rejected). Outcome **skipped — capture cost threshold not met**: recurrence high, debugging/token cost low under the shared high-cost capture criterion; EXDEV required a local mechanical copy/fsync correction after diagnosis. Actual distinct-volume restore verifies the fix. No canonical write, index rebuild or sync; these are not applicable. No project lesson file was read or written.

TDD cycle contains no commit/push. The user's standing authorization permits the subsequent separate Git handoff and automatic S08 continuation.
