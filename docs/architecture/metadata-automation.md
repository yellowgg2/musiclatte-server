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
