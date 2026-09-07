# Metadata jobs and file transaction boundary

Phase 4 Step 01 introduces additive management schema v9 and strict metadata wire contracts.
The existing numeric `MediaLink.revision` continues to describe binding changes. An opaque
`expectedRevision` and private SHA256 digest describe file contents independently. No metadata
endpoint, writer, worker runtime, or capability is enabled by this step.

## Request and response contracts

`packages/contracts/src/metadata.ts` defines explicit omit/set/clear intent. Omitted fields remain
unchanged. Cover and lyrics operations always identify their logical frame selector; a preview
frame handle is not a patch selector. Requests reject unknown properties, empty patches, null
patches, duplicate identical targets, unbounded batches, and malformed selector/value types.
Batch requests are bounded to 100 targets, text arrays to 32 values, ordinary text to 4096
characters, and plain lyrics to 100000 characters. These are defensive input limits, not a
throughput guarantee. The service must also reject different track IDs resolving to the same
managed file; the ledger enforces unique MediaLink and canonical file identity per job.

Public item/job/snapshot decoders reject internal fields and inconsistent file-save receipts.
Only projected track handles, revisions, supported fields, observable stages, and recovery
actions cross the API boundary. Existing generic API conflict/forbidden/error contracts and
disabled metadata capability keys are reused; producer activation belongs to Step 06.

## Ledger and authorization boundary

`metadata_jobs` stores scoped HMAC identity/operation hashes and a canonical request hash. An
identical replay returns the original job; another body under the same operation conflicts.
The authenticated service owns HMAC generation, canonicalization, current account/library
authorization and request validation. The repository accepts validated inputs and verifies
binding/library/session policy references inside its synchronous transaction.

Items preserve the accepted binding, digest, patch, actor session reference, policy revision,
parent item and restore backup lineage. Real tags and lyrics are private database content;
audio and cover bytes are never stored in SQLite. Cover uploads have scoped operation receipts,
relative private-store keys and expiry fields. Automatic upload cleanup must exclude references
from retained jobs/backups. Backups have no automatic deletion or retention API.

`claimNext` atomically claims the canonical file identity across accounts, increments the item
generation, and records an attempt. Another connection cannot claim that file while its lease
is active. Expired work is reclaimed before queued work, retaining its current stage; the old
generation cannot transition. This database fencing does **not** replace the OS file lock and
verified recovery required by Step 04. SQLite transactions never include network, subprocess,
or filesystem I/O.

## File and database atomicity

The intended sequence is preparing → backed_up → prepared → file_saved → reflecting → succeeded.
Backup registration precedes backed_up. File-save receipts contain both result digest and
opaque revision. A later failure retains the receipt and backup. `reflection_mismatch` is an
error while reflecting; `reference_conflict` is recovery_required. A file_saved receipt alone
never implies successful gonic reflection.

The database cannot atomically commit a filesystem rename. Step 04 owns real backup durability,
candidate validation, OS locking, fsync/replace receipts, and crash recovery. A repository stage
transition records the caller's verified observation; it is not independent proof of disk or
gonic behavior. Step 05 owns reflection and reference validation.

Failed-only retry creates a new scoped job and parent-item lineage, excluding previously saved
files. Restore creates a new job with a freshly supplied expected revision and a scoped source
backup; the restore writer must create its own preimage backup before replacing the current
file. Restoring never silently rewinds the history of the original job.

## Backup and migration

Migration 009 preserves existing v8 rows and adds eight metadata tables plus indexed history,
runnable items, file claims, upload expiry and monotonic change-feed access. Snapshot validation
checks public receipt consistency, private identity/digest fields, backup ownership, retry/restore
lineage and live claim/attempt relationships in addition to existing schema, key, quick-check
and foreign-key validation. A DB+credential-key snapshot preserves the ledger; it does **not**
contain music or backup payloads. Matching private file-store backup/restore belongs to Step 07.
Unsupported future schemas remain rejected, and old images alone are not a rollback strategy.

Verification: [Step 01 evidence](../verification/phase-4/step-01/README.md).
