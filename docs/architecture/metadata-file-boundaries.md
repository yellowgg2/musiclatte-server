# Metadata file resolution and revision

Phase 4 Step 02 resolves server-provided track paths through a private, opt-in policy. It does
not enable metadata endpoints, tag writing or worker execution.

`readMetadataConfig` defaults to disabled. Enabled mode requires absolute operator-owned
`METADATA_POLICY_PATH`, `METADATA_MUSIC_ROOT`, `METADATA_PYTHON` and `METADATA_HELPER_PATH` values.
The policy is schemaVersion 1 with `enabled`, `libraries`, `restoreManagers` and `limits`.
Each library declares `id`, `musicFolderId`, `relativeRoot`, `editors`, `writeProfile`
(`exclusive` or `read_only`) and `preserveOwnership`. Limits contain `maxTargets` (1–100),
`maxFileBytes` (1–2 GiB) and `timeoutMs` (1–120000). Duplicate IDs and overlapping/case-folded
root mappings are rejected. Engine/import manager status grants no metadata authority.

The resolver takes an already verified session and an opaque track ID. It checks that the
session remains live, obtains `recentSong` and music folders using that account's upstream
client, verifies the exact track ID and one configured root, then opens the file through the
helper. It rechecks session liveness after asynchronous work and before binding. Metadata
editors can inspect a read-only profile; writing requires exclusive ownership policy, a ready
worker and an eligible file. Restore additionally requires current administrator role and the
explicit restore-manager list within the visible library.

Existing links are revalidated by exact current path/ID. Verified legacy paths obtain a durable
MediaLink without generating an ImportJob or DownloadEvent. Conflicting non-null song IDs are
not silently reassigned. `bindVerified` is a synchronous guarded transaction, leaving unchanged
bindings and their numeric revisions intact. Its caller must establish account/file evidence.

## Descriptor and digest contract

The standard-library-only `apps/api/helpers/file_access.py` requires Python >=3.10. The Node
caller captures root device/inode, sends a bounded JSON request on stdin and receives only
private inspection fields or closed error codes. The existing process runner now supports
bounded text stdin mutually exclusive with its existing audio descriptor input. It retains
process-group timeout/abort/output bounds; raw request contents are not logged.

The helper opens root, each parent and the leaf with `O_NOFOLLOW`, directory-relative `os.open`
and retained descriptors. Non-regular files and replaced directory/leaf identities are refused.
It verifies the path still links to the retained descriptors after hashing. Hardlinks and
files without write-mode bits can be read for diagnosis but are not eligible for writing.
API mount write access is deliberately not used as proof of worker write access. The actual
worker must verify ownership/mode preservation and writable storage immediately before writing.

SHA256 is streamed with a file-size bound and before/after device, inode, size, nanosecond mtime,
ctime, mode, link count and owner checks. A changed read is retried once, then reports
`read_unstable`. Full-file digest is not an audio-payload digest. The instance signing key
HMAC binds domain, library, relative file key and digest into an opaque fileRevision; another
login does not change it. Expected revisions are never automatically replaced after conflict.

Root operators must exclude simultaneous external tag writers during the write interval.
Advisory locks and POSIX rename do not provide content-CAS against an uncooperative writer.
Step 04 owns OS locking and revalidation at write/replace; this step only establishes safe read
observations and preliminary eligibility. Normal playback does not violate the exclusive tag
writer requirement. No filename moves, actual tag edits or public path fields are introduced.

Reference: Python's [descriptor-relative filesystem API](https://docs.python.org/3/library/os.html#os.open).
The helper retains descriptors inside one process; it never treats a JSON fd number as a
transferable operating-system handle.

## Organization rename boundary

Schema v24 records the source device, inode, full digest, mode, uid/gid, audio identity, and the
prepared target-parent device/inode before the organization item may enter `moving`. The
organization helper creates target parents descriptor-relatively at mode 0750, rejects symlinks
and Unicode/case-equivalent names, and later requires the same retained parent identity. It never
uses a copy/delete fallback: source and target parents must be on one filesystem.

The worker acquires source and target OS fences in canonical file-identity order, then rechecks
the shared publication ledger for active import, metadata, or curation writers. The helper performs
one directory-relative rename, fsyncs both parents, and verifies source absence plus unchanged
target inode, digest, ownership, mode, and audio-packet identity. Empty legacy parents are retained.

An interrupted `moving` lease becomes filesystem-owned `recovery_required`. Descriptor inspection
classifies only a matching source as `source_only` and only a matching target as `target_only`;
both, neither, or any identity mismatch remain ambiguous. Source-only retries the same guarded
rename and target-only advances without renaming again. Reverse movement is never automatic.
