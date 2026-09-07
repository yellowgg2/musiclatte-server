# Durable metadata replacement

One Python process retains a per-file `flock` on a stable private lock file through the entire
transaction. The Node worker holds a renewable SQLite lease/generation and validates ownership
before each acknowledgement. An expired lease cannot bypass a still-held OS lock. Lost parents
and stale generations cannot commit another worker's DB receipt.

The private store must be canonical, owned by the worker, mode 0700 and outside the music root.
Source/candidate access retains directory descriptors and rejects symlink/root/leaf replacement.
Supported writable profiles are exclusive POSIX regular files with one link, writable mode,
no special mode/flags, ACL or extended attributes. Linux uses descriptor xattr inspection;
macOS development checks use descriptor-native xattr/ACL calls. Unsupported ownership/security
metadata is rejected, never silently stripped. With ownership preservation enabled, inability
to retain uid/gid also rejects publication. S07 owns deployment readiness enforcement.

1. Revalidate current session/scope/policy/binding through the injected authorization adapter.
2. Stream a private O_EXCL backup, fsync bytes and directory, verify its preimage digest, and
   persist the private journal. Emit `backup_verified`; Node commits the scoped backup manifest
   and `backed_up` before acknowledging.
3. Stream a same-directory random `.musiclatte-<opaque>.metadata-pending` candidate. Apply the
   S03 helper in this same locked process, or copy a scoped verified restore backup exactly.
   Preserve mode/owner, advance mtime, fsync, and persist verified candidate digest in the journal.
4. Emit `candidate_verified`; Node rechecks current authorization/fence, records the candidate
   intent in `prepared`, then acknowledges publication.
5. Recheck source identity/stat/full digest and candidate inode/digest. Atomically replace the
   leaf without first unlinking it. Fsync its directory, reopen and verify the final snapshot.
6. Emit `file_saved`; Node commits the receipt before acknowledging. Session expiration after
   publication cannot prevent recording/recovering the result. S05 alone owns reflection and
   `succeeded`.

The journal is bounded, written using O_EXCL temporary files + fsync + atomic replacement,
and stays outside the scan root. It is recovery evidence, not a substitute for the public DB
ledger. Source media is streamed in bounded chunks. The pending suffix differs from the plan's
illustrative `.pending` by retaining S03's private `.metadata-pending` contract; it remains a
non-audio extension. S05 must verify that the actual gonic scanner ignores it.

On restart, recovery reacquires the same OS lock, verifies the backup and compares final bytes.
Preimage means safe failure requiring a fresh user retry; a verified candidate means recover
only the receipt and fsync the directory. Any other observation means `recovery_required`;
all evidence stays intact and subsequent claims on that file are blocked. A DB candidate digest
must agree with the journal. No inferred automatic restore occurs. Existing open streams retain
the old inode; a new stream opens the replacement.

Failed or pre-write-conflict child retries require newly validated input and exclude saved
items. Restore resolves a scoped manifest rather than interpreting a backup ID as a path,
requires the current expected digest/revision, and backs up its own preimage before restoring
exact historical bytes. A restore can itself be reversed.

There is no user cancellation API after submit. A signal before publication abandons the
candidate; after publication, the next worker classifies the durable intent. The worker does
not claim new work once its signal is aborted. Unknown outcomes are preserved for reconciliation.

Atomic rename is not a compare-and-swap against noncooperating external writers. Exclusive
writer configuration remains mandatory; observed conflicting bytes are never overwritten during
recovery. The library readiness layer must make unsupported/external-writer profiles unavailable.
