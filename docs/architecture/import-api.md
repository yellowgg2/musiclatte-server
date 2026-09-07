# Imports API

Phase 3 Step 05 adds account-scoped durable import admission and history. API handlers never
run a downloader, spawn a process, scan gonic, or probe the music filesystem. The existing worker
claims the committed queued items. Web `clientFeatures['imports.youtube']` remains false until
its consumer Step, independently of this server producer.

## Wire and authentication

`packages/contracts/src/imports.ts` owns public job/item/library types, stage and failure enums,
and strict request/response schemas. Fastify keeps its 16,384-byte encoded body limit and rejects
unknown fields without stripping or coercing them. No separate batch-count limit is introduced.

| Endpoint                           | Input                                          | Success                                            |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| GET `/api/v1/imports`              | Only cursor and limit; default 20, maximum 100 | 200 jobs, allowed library IDs, nullable nextCursor |
| GET `/api/v1/imports/:id`          | Signed job handle, no query                    | 200 job with ordered items                         |
| POST `/api/v1/imports`             | Exact operationId, libraryId, urls             | 202 claimed or replayed job                        |
| POST `/api/v1/imports/:id/retries` | Exact operationId, itemIds                     | 202 new child job or replay                        |
| DELETE `/api/v1/imports/:id`       | No body or query                               | 200 current job and cancellation request timestamp |

Reads accept existing cookie or bearer sessions. Imports mutations are web-cookie-only in v1:
JSON Content-Type, exact Origin, X-Musiclatte-Client:web and X-CSRF-Token are mandatory. Bearer
mutation returns 403; future external write scope belongs to P5/P6. A route-local JSON parser
allows the empty DELETE body while preserving normal JSON parsing elsewhere.

Every request verifies the current upstream identity before access and again before returning
a successful response. Revocation/expiry during the second verification suppresses the result.
A job already committed before that revocation remains durable; the HTTP response does not
claim that the mutation was rolled back.

Malformed schemas/queries return 400, missing/expired authentication 401, policy/CSRF denial
403, foreign or invalid job handles 404, operation conflict 409, invalid source or nonfailed
retry selection 422, invalid Content-Type 415 and oversized body 413. Worker/engine unavailability
uses the existing safe 503 `upstream_unavailable` envelope. Errors never include raw input or
repository/upstream error messages.

## Identity, history and idempotency

The service HMACs instance ID plus verified username into a durable identity key. Operation IDs
reuse the existing base64url 22–128 contract; only HMAC operation/request fingerprints are stored.
YouTube URLs are parsed by Step 02 and only ordered canonical video IDs reach storage. Equivalent
URL aliases replay the same job. A different canonical request under the same operation returns 409. Previously claimed operations still replay during worker downtime; new admissions return 503.

Public job, item and media handles use separate HMAC purposes and account/instance binding.
History cursors also bind the current allowed library IDs and the final `(createdAt,id)` tuple.
History is ordered descending by that tuple using `import_jobs_history`; a changed library scope,
another identity/instance or a tampered token invalidates the cursor. History is live keyset
pagination, not the separate recent-download snapshot contract owned by Step 06.

## Duplicate, retry and cancel semantics

Schema v6 preserves existing rows and references while extending import_items with nullable
`duplicate_of_item_id`. A duplicate must reference an existing MediaLink or source item; it is
terminal for admission and cannot be claimed by the worker. The rebuilt table retains existing
indexes and adds the account history index. Upgrades validate foreign keys before commit.
Existing backup/restore includes the new reference; old schema binaries cannot open schema v6.
Rollback requires the matching pre-upgrade database/key backup rather than running old code
against the upgraded database.

Admission and duplicate detection share a synchronous SQLite writer transaction. An available
MediaLink for the canonical source/library wins; otherwise an in-flight item in that library is
referenced, including earlier inputs in the same batch or another account's job. Public references
are signed for the current account and do not grant access to another account's job. No duplicate
DownloadEvent is created. A duplicate reference records admission deduplication; it does not imply
that an in-flight source has become ready.

Retry accepts only failed source items, sorts selections by original item order, and creates a new
job with retryOfJobId. Queued, ready, registering, duplicate and cancelled items are not retryable.
Retry admissions use the same duplicate rules. Cancel records a cooperative request and immediately
cancels unclaimed queued items; running work remains running until the worker acknowledges it.
Terminal jobs return unchanged, including their cancellation timestamp. Published files, media
links and download events are retained.

## Projection and capability

The service explicitly projects every public field before response serialization. Unobserved
metadata is omitted; observed title/channel may appear later. Raw URLs, credentials, argv, stderr,
absolute/relative file paths, lease owners and operation/identity fingerprints are absent. Unknown
stored failure text maps to the fixed `download_failed` code.

`createConfiguredApp` passes validated import policy, the management database and a clock into
AuthOptions. Capability reads persisted worker/engine state only:

| Condition                                                                               | supported | permission | availability            |
| --------------------------------------------------------------------------------------- | --------- | ---------- | ----------------------- |
| IMPORTS_ENABLED=false or no import configuration                                        | false     | denied     | available               |
| Enabled without an allowed library for this user                                        | true      | denied     | available               |
| Allowed user, idle/working worker and active healthy engine                             | true      | allowed    | available               |
| Missing/stopped/unhealthy worker, stale/future heartbeat or failed/uninitialized engine | true      | allowed    | temporarily_unavailable |

Heartbeat age must be nonnegative and strictly below 30,000 ms. Availability contributes to the
existing capability revision. History and cancellation do not require worker availability;
permission is still checked. This private producer does not change `/rest`, player, playlist,
favorite, native or bot behavior. UI/Gallery/Chrome work remains with the later consumer Steps.
