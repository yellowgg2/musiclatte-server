# Phase 4 Step 04 — backup, replacement and recovery

Implemented 2026-09-08 from `0c253b4` on
`yellowgg2/tdd/phase-4/step-04-durable-write-restore`. Five intended RED assertions failed for the
absent file-store implementation. Final real-subprocess worker suite has 10 passing tests.

## Local evidence

- An open descriptor continues reading exact preimage bytes after publication; the new path
  exposes the verified candidate. Backup bytes match the preimage. Restore reproduces original
  bytes and keeps the edited preimage in another backup.
- Actual process death after backup verification, candidate verification, and final save;
  an injected exit immediately after rename and before directory fsync. Recovery distinguishes
  preimage from published candidate without rewriting the final file.
- DB-backed lost-receipt recovery after lease expiry, rejection of old generation, and no
  reauthorization of expired actor input when only the already-published receipt is recovered.
- A second helper cannot publish while the first holds its OS lock awaiting an acknowledgement.
- External synthetic writes immediately before publication and after save remain untouched and
  classify as manual recovery. Read-only profile and injected ENOSPC fail before replacement.
- Every crash test asserts it actually reached its intended cutpoint. Unknown outcomes retain
  their journal/backup/candidate for inspection; test-owned temporary roots are removed afterward.

The first local run exposed platform differences: this macOS Python build lacks `os.listxattr`,
and an empty native ACL reports ENOENT. Descriptor-native calls now distinguish unsupported
permissions from a clean profile. The production Linux path has separate actual evidence below.
A test import type was corrected after typecheck; the final typecheck passed.

## Isolated Linux evidence

Read-only preflight found Linux 5.10.0-21-amd64 x86_64, ext4 rw/relatime, occupied ports 42025
and 4747. Host Node 22.23.2/Python 3.9.2 were preserved. Existing gonic-demo stayed running.
An isolated test image based on Node 24.20.0 bookworm-slim installed Python 3.11.2, the exact
Mutagen 1.48.1 wheel hash, and Debian FFmpeg/FFprobe 5.1.9-0+deb12u1. This is a test image,
not production deployment. The probe container used UID/GID 1000 and `--network none`.

`tools/verification/metadata-file-probe.ts --config <private absolute config>` ran against a newly
created `musiclatte-p4-...` synthetic subdirectory of the allowed live music root, with its private
backup directory outside scan. It verified open stream, new stream, exact backup, exact restore,
and killed-child/restarted receipt recovery. The final probe exited 0. `stat -f` reports the
ext-family magic as `ext2/ext3`; host `findmnt` identifies the mounted filesystem as ext4.

An initial functional pass ended nonzero because cleanup tried removing a bind-mount root.
Cleanup now removes only probe-owned contents, retains the empty mount root, and reports success
only after cleanup. The complete corrected probe was rerun and exited 0. Host checks confirmed
both directories empty, removed the owned music subdirectory and found no probe containers.
Existing gonic-demo remained `Up 2 days`. No real songs, private tags or authentication values
were copied into artifacts. The dedicated test runtime image remains reusable for following
Phase 4 probes; it is not attached to any running service.

## Gates

- Affected worker/helper/storage/import-worker tests: 63 passed in four files before the added
  rename cutpoint; final worker suite: 10 passed, zero skips.
- Metadata-schema contract: 3 passed, zero skips.
- `npm run typecheck`: final exit 0. `npm run build`: exit 0.
- Formatting ran before verification; final `npm run format:check` exited 0 before Git handoff.

No UI, locale, Gallery diff or UI review debt. Rulebook lookup yielded no applicable new lesson;
postflight `skipped(no_new_lesson)`, no central writes/sync. This step adds repository private-work
lookup/renewal, safe conflict retry and recovery-blocked file claims, alongside the file worker.
S05 owns gonic reflection/pending exclusion, S06 authorization adapter/public API integration,
and S07 readiness/runtime installation. Vault records remain outside this repository commit.
