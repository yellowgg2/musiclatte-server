# Metadata automation

Automation is opt-in. The default installation does not issue personal access tokens. Existing cookie and legacy bearer sessions keep their transport and CSRF behavior.

## Configuration

Set `AUTOMATION_ENABLED=true` and `AUTOMATION_CONFIG_PATH` to an absolute path to an operator-owned JSON file with no group/other permissions. Metadata must already be enabled with its validated policy. Example values below are synthetic deployment choices, not retention guarantees:

```json
{ "schemaVersion": 1, "maxTokenAgeMs": 3600000 }
```

The configuration file and credentials stay outside Git and Docker build contexts. The supplied name `automation-config.json` is ignored by both. Never pass credentials through URLs, source fixtures, command output or logs.

## Token API

- `POST /api/v1/access-tokens`: existing session only; JSON `{name,scopes,libraryIds,expiresAt}`. Returns 201 `{schemaVersion:1,token,accessToken}` with `Cache-Control: no-store`. The original secret is returned only here. There is no issuance replay that returns a prior secret.
- `GET /api/v1/access-tokens?limit=25&cursor=...`: current owner only; returns metadata, total and authenticated next cursor. Limit is 1–100. Revoked/expired entries remain visible for audit. Tampered or cross-owner cursors return 400.
- `DELETE /api/v1/access-tokens/:id`: owner only; returns 204, including repeated revocation. Other owners receive 404. Browser mutations require exact Origin, web client intent, JSON and session-bound CSRF. Native bearer DELETE may omit its body.

Name is trimmed and restricted to 1–120 code points without controls. Scopes are `metadata:read`, `metadata:write`, `lyrics:write`, `curation:write`; every write requires read, and lyrics also requires metadata write. Scope/library arrays must be nonempty and unique. Requests never silently gain scopes. Expiry is greater than server time and within configured max age.

Issuance intersects the current canonical upstream account, configured metadata editor allowlist and actually accessible upstream music folders. An upstream folder list or admin label alone does not grant edit permissions. A PAT can only narrow these libraries/scopes further.

If the creation response is lost, list token IDs/names/timestamps, revoke the uncertain token ID, and issue a replacement. The secret cannot be redisplayed. Server authentication and errors omit raw request bodies, URLs and upstream errors.

## Authentication boundary

Only the exact `mlpat_` prefix selects the separate PAT verifier. Explicit metadata consumers use `verifyMetadataPrincipal`; they do not fabricate a session. Every PAT verification rechecks current upstream identity and library access plus stored expiry, revocation and policy revision before/after network I/O. Wrong identity/authentication invalidates the PAT (401), insufficient permission returns 403, and transient upstream failure returns 503 without revocation.

S01 exposes token management only. P4 metadata routes still reject PATs until S02's adapter exists; curation is not advertised. Session, scan, imports, playlists and restoration do not accept PAT authentication. Cookie+Authorization and duplicate credentials are rejected. Token query parameters are not supported.

Web logout does not revoke independently issued PATs. Global authorization-policy invalidation revokes both session and PAT credentials. Offline restore follows the user's 2026-09-09 decision: retain the existing session restoration behavior, revoke restored PATs and rotate a separate automation credential epoch. S02 connects job-grant invalidation to that same restore boundary. Old automation cursors cannot be reused; audit metadata is retained.

`automation.tokens` is advertised only for the actual configured producer and current account permissions. `metadata.curation` and web client support remain disabled until their owner steps implement them.

## P4 principal adapter (S02)

Scoped PATs can read track metadata, their own frame/upload handles and their own admitted jobs. A read-only PAT receives `editable:false`; PATs never acquire restore authority. Cover upload additionally requires metadata write scope. Public PAT job submission remains disabled until the automation claim/write routes are implemented. Ordinary session routes and legacy metadata mutation payloads retain their behavior.

The account identity HMAC remains instance + canonical username. Token ID and scoped credential fingerprints separately bind frame handles, uploads, job history and replay. A token cannot read another token's or a legacy session's jobs even if both belong to the same account; sessions retain account-owned history.

Schema 16 rebuilds metadata items with mutually exclusive nullable session/token FKs, preserving the existing dependent FK graph and indexes. Accepted PAT file intents receive an AES-GCM grant bound to their immutable item/owner/library/binding/revision/patch/policy and automation epoch. Token revocation prevents new requests but does not expand or cancel that accepted intent. The real metadata worker uses the grant only to obtain its upstream proof, then rechecks canonical account, folders, current metadata permissions, file binding and path before publication. Session workers retain their original session verification path.

Definitive terminal jobs discard grant envelopes. Offline restore and global authorization-policy invalidation discard automation grants without deleting their audit actor or recovery ledger. Restore retains ordinary sessions as decided by the user. Restored/invalid grants cannot authorize a new publish; existing journal/recovery state remains available to the normal session recovery controls.

## Curation storage (S03)

Schema 017 stores review state separately from optional field evidence and immutable completion receipts. Snapshot selection is frozen and credential-bound with explicit TTL/capacity errors. Offline restore preserves receipt history and ordinary sessions while rotating claim authority and marking file verification stale. These primitives are not HTTP mutation authorization; subsequent services must hold the common publication fence and verify current permissions/revision.

## Curation read API (S06)

Configured curation reads use `/api/v1/metadata-policy`, `/api/v1/tracks` and `/api/v1/tracks/:id/curation`. Policy is read-only `required-v1`; lists contain an `asOf` snapshot and coverage, not a live filesystem guarantee. `missingField=lyrics` equals `field=lyrics&fieldStatus=missing` and combines independently with `curationStatus=completed`. Supported filters are curationStatus, missingField or field/fieldStatus, format and libraryId. Limit defaults to 25, max 100. Opaque cursors bind the current credential, libraries and filter. A 409 snapshot_expired/snapshot_scope_changed requires a fresh list; 503 snapshot_capacity permits retry later. P4 metadata preview remains the source for fresh editable file values.

## Automation admission (S07–S08)

Curation claims are expiring reservations, independent of file fences and worker journals. Required review affects effective progress; optional enrichment preserves existing completion. New automation writes use the existing metadata-jobs endpoint with a required claim/generation/purpose envelope and explicit dryRun. Dry-run is advisory; submit revalidates under shared file fences. Durable curation operation receipts associate claims, P4 jobs and partial admission outcomes. Only succeeded associated jobs advance an unchanged claim binding/revision baseline; all other file changes require fresh review. Metadata attempts can record only verified missing optional fields and never alter file tags or mark review complete.

## Explicit completion (S09)

POST track curation complete requires a live required-review claim and fresh file revision/policy. The API verifies actual MP3 title/artist, audio identity, current path/binding, authenticated index projection and unresolved jobs while holding the shared file fence. Receipt/state/replay are atomic. Completion consumes that target reservation; same operation retries return its original receipt. Reopen records a reason and preserves receipt history. Optional-only changes preserve the first receipt; no write automatically completes review. Typed curation error reasons distinguish missing required fields, revision/policy/identity conflicts, expired claims, pending/failed work and reflection delays. Runtime readiness controls availability separately from route support.

## S10 runtime and restored snapshots

The opt-in automation overlay supplies a strictly bounded `required-v1` policy and a private
shared fence volume to API/P4/P3 under the same UID/GID. Inventory runs as the final bounded
metadata scheduler turn, forwards cancellation and resumes durable checkpoints. Stale restored
inventory restarts discovery immediately. Capability availability includes actual worker health
and inventory readiness. API keeps read-only music and no worker backup/credential mounts.

Completed backup artifacts are checkpointed and sealed in DELETE journal mode before verification
so read-only restoration does not depend on WAL shared-memory sidecars. Only the new snapshot is
changed. Restoration still preserves web/legacy sessions while invalidating automation credentials,
claims and cursors; fresh file/index validation is required before work resumes.

## Web consumers (S11–S12)

Settings uses session-owner-only `/api/v1/access-tokens/options` for the current selectable libraries,
scopes and configured maximum token age. The API rechecks permission at creation; the UI never derives
access from unrelated import configuration. One-time secrets remain in component memory and uncertain
issuance is resolved through metadata inspection/revocation, without an automatic creation retry.

The Music area links to `/music/curation`. Frozen list counts/pagination and current detail are explicitly
distinct; required review completion coexists with optional missing/unavailable fields. Existing metadata
editor and change-feed consumers update current curation state. Scope/identity/filter changes discard
obsolete responses, and a 409 cursor boundary restarts the list. Existing playback provider identity and
selection ownership remain unchanged. Source-only browser fixtures are excluded from production builds.
