# Engine management API

Phase 3 Step 08 adds the administrator API and its durable worker mailbox. Step 07 remains
responsible for executable validation, activation and immutable leases. Step 09 owns process
entry, timer/shutdown and Compose wiring; Step 12 owns the web settings consumer.

## Authorization and protocol

Both methods at `/api/v1/engine` require a current authenticated identity, enabled import policy,
`identity.adminRole === true` and exact membership in `policy.engineManagers`. Library import
permissions do not grant engine management. Every request verifies identity again before the
final synchronous policy check/read or admission transaction. Session revocation during identity
I/O prevents a write. Roles supplied by clients are never accepted or persisted.

GET accepts no query (including a bare `?`) or body. It is read-only and does not check for an
update, probe files, execute processes or perform an engine network request. Authorized managers
can read diagnostics while the worker is unavailable. Cookie and existing session bearer reads
are supported; bearer mutations are denied rather than introducing future automation scopes.

POST requires a cookie session, JSON, the configured Origin, web client header and CSRF token.
Its exact request union has `additionalProperties: false` in both branches:

```json
{ "action": "check_now" }
```

```json
{ "action": "restore_previous" }
```

Unknown actions, extra fields, queries, version/channel/path/url/binary/command inputs and forged
roles are rejected before admission. POST returns **202 with the current EngineStatusResponse**;
acceptance is an intent receipt, not a promise that a check ran, a candidate passed validation,
or the active selection changed. The response has the same shape as GET; no `accepted` or
internal request identifier is added.

## Public projection

`packages/contracts/src/engine.ts` exports `EngineStatusResponse`, `EngineActionRequest`,
`engineStatusSchema`, `engineActionSchema` and `engineEmptySchema`, re-exported from contracts.
The response allowlist is exactly:

| Field                                              | Contract                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| schemaVersion                                      | 1                                                                                                                     |
| channel                                            | nightly                                                                                                               |
| activeVersion / candidateVersion / previousVersion | bounded safe version label or null                                                                                    |
| lastCheckedAt                                      | attempt-start UTC epoch milliseconds or null                                                                          |
| lastSuccessfulCheckAt                              | successful preparation attempt-start UTC milliseconds or null                                                         |
| status                                             | never_checked, checking, up_to_date, candidate_pending_validation, active, update_failed, validation_failed, restored |
| recoverability                                     | available, no_previous, temporarily_unavailable                                                                       |

`lastSuccessfulCheckAt` maps the private `lastCheckSucceededAt`; it does not mean source extraction
succeeded. `recoverability` describes whether a previous selection is eligible for a restore
request. A missing previous yields `no_previous`; stale worker, active operation or a failed
restore receipt for the current pair yields `temporarily_unavailable`. `available` still requires
the worker to validate files before execution; API processes do not need an engine-volume mount.
A successful restore replay is a harmless acknowledgment.

Executable paths, candidate keys/hashes, operation tokens, arguments, raw errors, stderr and
credentials are absent. Fastify logging remains disabled and its existing safe error mapper is
used. All responses use `Cache-Control: no-store`.

| Rejection                                                                    | HTTP / existing stable code |
| ---------------------------------------------------------------------------- | --------------------------- |
| Missing, expired or revoked session                                          | 401 / unauthenticated       |
| Disabled policy or non-manager                                               | 403 / forbidden             |
| Cookie security failure                                                      | 403 / csrf_rejected         |
| Non-JSON mutation                                                            | 415 / invalid_request       |
| Invalid query/body/action                                                    | 400 / invalid_request       |
| No previous, conflicting pending action, busy restore, known failed previous | 409 / conflict              |
| Worker stale/stopped/future heartbeat or no active engine                    | 503 / upstream_unavailable  |
| Invalid stored state                                                         | 503 / storage_unavailable   |

## Durable actions and replay

Schema **v8**, migration `008-engine-requests.sql`, adds only the bounded singleton
`engine_requests` mailbox. Existing v7 engine/session/job/media/event records remain unchanged.
The mailbox stores a closed action, requested selection pair, attempt time, pending/running/
completed/failed status, expiring owner and last successful restored pair. No user credentials,
raw URL, binary path or process output is stored.

`createEngineRequestRepository().request()` performs synchronous `BEGIN IMMEDIATE` admission.
Same-action pending/running requests coalesce across API instances. A different pending action
conflicts. `check_now` requests the existing scheduler's daily eligibility check: it **does not
bypass the 24-hour limit**, including failed attempts. Checking, a pending candidate, a backward
clock and an already-consumed daily interval produce 202/current state without another intent.
An accepted pending check does not itself set engine status to `checking`.

Restore admission pins active/previous. It rejects a missing previous, a live engine operation,
or a known failed restore for that pair. The mailbox retains the successful restored pair across
later check receipts/status changes, so replay cannot toggle active and previous. A new activation
creates a different pair and can be restored. A failed pair remains unavailable until selection
changes or operator recovery verifies and reconciles the private state; no arbitrary repair
command is exposed by this API.

`createEngineRequestWorker({database, clock, provider}).processNext(signal?)` is the worker-only
consumer. It claims one intent for 120 seconds, recovers the provider's authoritative manifest,
then calls existing `checkDue` or `restorePrevious(expectedPair)`. Files/process work stays outside
SQL transactions. Provider restore compares the pinned pair under its existing engine-operation
claim, validates previous with the existing file/hash/version/dependency checks, and changes only
next-job selection. Running leases and stored music remain untouched. Already committed restores
are recognized after crashes, instead of performing another swap. Late owners cannot overwrite a
new receipt. Busy/aborted operations return to pending; other failures store only `failed`.

The API imports neither provider nor updater nor request-worker. `AuthOptions.imports` and
`createConfiguredApp` already supply the database, strict policy and clock, so no duplicate engine
configuration, credential path or new API process capability was added.

**Step 09 handoff:** initialize the provider in the worker process, invoke/await `processNext`
on worker ticks, keep the ordinary `checkDue` timer, and await owned work during shutdown.
No consumer timer is started by importing the API. Step 08 integration tests invoke the consumer
against the real provider with synthetic standalone executables and isolated SQLite/filesystems.
Actual nightly/network execution and deployed scheduling remain Steps 09/14.

## Capability and compatibility

`engine.manage` is false/denied/available when disabled; true/denied/available for an enabled
non-manager; true/allowed/available for a healthy manager; and true/allowed/temporarily_unavailable
for a stale worker, missing active, engine update/validation failure or failed current restore.
A current manager can still read diagnostics and submit eligible recovery actions after an
engine check failure when the worker and active engine exist. An outage is not loss of permission.

Capability construction rechecks identity after the random-song network probe when imports are
enabled. Its opaque HMAC revision includes current identity, policy and capability values, without
publishing policy content. Capability reads do not start engine work. Engine failure does not
change API readiness or stored-music playback; imports retain their existing usable-active fallback.

`apps/web/src/capabilities/client-features.ts` keeps `engine.manage=false`; contract tests verify
that even an available producer cannot open its web entry. Settings/player/navigation, Gallery,
gonic, bot and native trees are unchanged. No UI review debt or new translated copy is introduced.

## Backup and rollback

The existing online backup includes v8 pending/running/completed receipts and restored-pair
replay protection. Restore the matching engine volume separately, with writers stopped; a DB
snapshot never embeds binaries. Expired receipts can be reclaimed and committed restores are
reconciled through the manifest. A v7-to-v8 migration and v8 mailbox backup/restore are tested with
real SQLite and encrypted sessions. Roll back to the previous application only with a complete
matching pre-v8 snapshot; do not run the old application against a v8 database.
