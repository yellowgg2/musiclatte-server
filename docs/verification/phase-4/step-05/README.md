# Phase 4 Step 05 — gonic reflection

Implemented 2026-09-08 from `8dfbdf9` on `yellowgg2/tdd/phase-4/step-05-gonic-reflection`.
Three intended RED assertions failed for the absent reflector. Final projection/reference and
real-ledger reflector tests: 9 passed, zero skips.

The shared scan/exact-path extraction preserved existing import scheduling and path semantics.
Real-ledger cases cover verified projection, mixed albums, changed IDs, stale covers, unknown
file revision, lost scan lease, private reference baseline, no download events, deferred retry
and restore priority. A known saved restore supersedes the old result without creating a false
manual-corruption blocker. Standard genre is now retained; unsupported fields are explicit.

## Live probe

Existing demo was inspected read-only: gonic v0.22.0, host port 4747, image ID
`sha256:bb97979da26038fb6003603ba53c6a4f55a0df1913791bf1b2b2d215928be70e`.
A separate container using that exact image ran on unused loopback port 14847. Its own music,
DB, cache, playlists and podcasts were isolated under an owned `musiclatte-p4-...` working path.
UID/GID 1000, embedded-cover scanning enabled, scan interval 0, watcher disabled, HTTP logging
disabled. The image listens internally on port 80; an initial mapping to 4747 failed before the
probe reached scan. Only the owned test container was recreated with the correct port mapping.

The S04 test runtime (Node 24.20.0, Python 3.11.2, hash-pinned Mutagen 1.48.1 and FFmpeg/FFprobe
5.1.9) generated two 150-second sine MP3s in the same channel folder, original synthetic lyrics
and small raster images. No real music or private metadata was used. A private config supplied
credentials; URL/auth parameters were not printed or committed.

The final `metadata-gonic-probe.ts --config <private absolute config>` exited 0 and verified:

- Pending `.metadata-pending` audio copy excluded from the two-track scan result.
- Title/artist/album/lyrics/cover file modification, stable exact-path song ID and search update.
- Ordered [A,B,A] playlist and star preservation before/after edit and restore.
- Open HTTP stream receives exact preimage despite replacement; new stream returns edited bytes.
- Seek Range returns exact bytes with 206; an old If-Range date returns the new full response.
- Known mixed-album projection mismatch on the other track, without false completion.
- Warmed cover size returns an old image, classified as exact cover-only mismatch; a previously
  unused size confirms the new source cover (diagnostic only, not a product workaround).
- Exact original-byte restore, stable restored ID/references, restored cover at the original
  warmed size, and exact restored HTTP stream.

The initial ordinary-projection assertion exposed the real warmed-cover limitation. Primary
handler/cache source confirmed it, and the probe now explicitly asserts the plan's allowed
cache-mismatch/recheck/restore behavior instead of hiding or claiming that result as succeeded.
Immediate warmed-cover propagation is unsupported on this profile. See
[metadata-reflection](../../../architecture/metadata-reflection.md) for downstream API/UI owners.

Probe-owned playlist/star were removed via public APIs, music/private directories were verified
empty, and the owned gonic container and working directory were removed. No probe container
remained; existing demo continued running. The reusable isolated runtime image is retained for
later Phase 4 probes and is not a running service. No gonic DB adapter, source change, volume
purge, native-tree edit, operational deployment or DNS change occurred.

## Gates

- Affected reflection/registration/import-worker/storage/metadata-worker: 92 passed, 5 files.
- Subsonic parity/playlist/favorites contract: 47 passed, 3 files.
- After retry/restore refinements: reflection/storage/engine-migration 19 passed; final reflection
  9 passed. No skipped or zero-test commands.
- Final `npm run typecheck` and `npm run build`: exit 0. Verification tools are now included
  in root typecheck, which also corrected protocol-version evidence typing.
- Formatting ran before tests; final format check is recorded at Git handoff.

The additive v10 migration is required to retain reference evidence and reflection deadlines
across restart; v9 item/jobs data is preserved. Version/table inventory assertions and the old
engine migration fixture were updated. No UI/locale/Gallery changes or UI review debt.
Rulebook lookup selected no new applicable lesson; postflight `skipped(no_new_lesson)`, no central
write/sync. The gonic cache finding is a project-specific verified support constraint and is
recorded in project architecture/vault instead of a speculative universal rule.
