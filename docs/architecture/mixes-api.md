# Saved mix API

`MIXES_ENABLED=true` enables a configured management repository and advertises
`mixes.saved` using current random support observation. It defaults to false.

- GET/POST `/api/v1/mixes`, GET/PATCH/DELETE `/api/v1/mixes/:id`.
- GET `/api/v1/mixes/:id/songs`: saved conditions plus one random result, with
  schemaVersion, mixId, revision, conditions, songs. No refill or queue mutation.
- GET `/api/v1/music/genres`: shared-library genre values and counts.

POST accepts operationId/name/conditions. PATCH accepts operationId/expectedRevision
and name and/or a complete replacement conditions object. DELETE accepts JSON
operationId/expectedRevision. Operation IDs are22–128 base64url characters. Successful
create is201, reads/updates/deletes200. Same-operation replay returns the original
result, including after deletion. Account+operation HMAC receipts and canonical request
hashes do not depend on session lifetime.

The authenticated instance and canonical account determine ownership. Unknown account
resources are404, stale revisions409. Missing selected music roots are409/conflict with
reason `mix_scope_unavailable`; filters never silently widen. The standard library
boundary handles upstream errors, abort, and current session/policy checks. Cookie
writes require Origin/client intent/CSRF/JSON; bearer writes preserve existing rules.
The scoped raw JSON parser rejects duplicate and escaped duplicate keys.

Lists return schemaVersion/mixes/nextCursor, with default50/max100 limit. Signed cursors
bind identity, page size, insertion high-water and immutable descending creation/ID
anchor. Deleted rows may vanish; no snapshot-membership guarantee. Timestamp output is
UTC ISO8601. No new web feature entry is enabled until S03.
