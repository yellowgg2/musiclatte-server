# Saved mixes

Schema20 adds account-scoped saved conditions and durable operation receipts without
storing song lists. `createMixRepository` commits the mutation and receipt together.
Exact operation replay returns the original snapshot; a changed request hash conflicts.
Deletion retains a tombstone and replay receipt. Update/delete require an exact revision.

List order is immutable creation time and UUID descending, fenced by insertion sequence.
Updates can change displayed conditions and deletes can remove rows between pages; this
is current-state pagination, not snapshot membership. The service owns authenticated
HMAC identity, operation hashes, registered-root validation and signed account-bound cursors.

`validateMixStorage` checks resource and receipt payloads on backup/restore. Restore needs
an application supporting the complete schema; no down migration or mixed old workers.
HTTP request schemas and strict normalized conditions live in contracts/mixes.ts. The
raw JSON parser rejects duplicate fields before ordinary parsing can discard them.
