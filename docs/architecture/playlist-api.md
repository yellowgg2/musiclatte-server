# Playlist API — Phase 2 Steps 03–04

The playlist BFF is an authenticated projection and mutation boundary over the configured gonic instance. Gonic remains the only playlist source of truth: the management database stores no playlist names, entries, covers, or snapshots. The database stores only durable operation receipts for idempotency and recovery.

## Routes and strict wire contract

Every route requires the existing cookie or bearer session, rejects every query parameter and unknown body field, returns `schemaVersion: 1`, and preserves opaque playlist and song IDs as strings.

| Route                          | Input                                     | Success                                                                                                           |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/playlists`        | no query                                  | source-ordered summaries with `editable`, informational `revision`, and fallback cover state                      |
| `GET /api/v1/playlists/:id`    | no query                                  | ordered `{position, song}` occurrences, exact detail `revision`, `editable`, and first-playable-entry cover state |
| `POST /api/v1/playlists`       | `{operationId, name}`                     | `201` with an empty reconciled playlist snapshot and `outcome: applied`                                           |
| `PATCH /api/v1/playlists/:id`  | `{operationId, expectedRevision, action}` | `200` with the reconciled current snapshot and applied/replayed outcome                                           |
| `DELETE /api/v1/playlists/:id` | `{operationId, expectedRevision}`         | `200` with a stable deleted result; applied replay never writes again                                             |

`operationId` is a 22–128 character base64url random identifier. Names are trimmed at both ends, must contain 1–255 Unicode code points, and otherwise preserve their text. `expectedRevision` is the opaque 43-character detail HMAC. The PATCH action is an exact discriminated union:

- `rename`: one new name.
- `append`: one non-empty ordered `songIds` batch.
- `remove`: one exact `{position, songId}` occurrence.
- `reorder`: a unique, complete permutation of current occurrence positions.

Only `application/json` is accepted. Cookie mutations additionally require the existing trusted Origin, `X-CSRF-Token`, and `X-Musiclatte-Client: web` boundary. Native bearer mutations remain separate and do not require browser CSRF headers. Current session and verified identity are rechecked after lock waits, upstream work, and before a success response; request disconnect aborts upstream work.

## Read projection, revision, and editability

List reads make one `getPlaylists` call and never fan out to detail. Detail makes one `getPlaylist` call. Duplicate song IDs remain separate positions: `[A, B, A]` is returned as positions 0, 1, and 2.

The server signs revisions with `SessionService.sign('playlist-revision', canonicalValue)`. The canonical value contains instance ID, verified current username, playlist ID, name, changed timestamp, and either the exact ordered entry IDs for detail or `null` for a summary. Only a detail revision is a mutation precondition.

`editable` is true only when the verified identity username exactly equals the upstream playlist owner. Every existing-playlist write rereads detail immediately before claiming its receipt and rejects stale revision with `409 conflict` or a non-editable resource with `403`, without an upstream write.

## Mutation mapping and single-process serialization

Create always creates an empty playlist. Rename and append issue exactly one `updatePlaylist` call. Remove first verifies the position/song pair, and reorder first verifies a complete position permutation; both then issue one `createPlaylist({playlistId, name, songIds})` full replacement. Product mutation paths never call `songIndexToRemove`, so duplicate IDs are not collapsed or removed ambiguously.

An in-memory promise queue serializes writes by signed account plus playlist key; create serializes by account. The key is removed when the work settles. This coordinates one API process only. There is no distributed lock, database lock spanning the network call, or claim that native `/rest` clients are serialized.

## Durable receipts and reconciliation

The service derives HMAC fingerprints for verified identity, operation ID, and canonical request through `SessionService.sign`, then stores only fixed-length hex fingerprints and receipt status. Receipt rows are recovery metadata, never a playlist cache.

The sequence is: keyed lock → current session/detail/revision/editability check → receipt claim → one upstream write → session/detail reread → exact desired-state comparison → applied or uncertain receipt transition.

| Condition                                                                                    | Result                                                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| same operation and same applied request                                                      | no upstream write; return the current/reconciled result                                               |
| same operation with a different request fingerprint                                          | `409 conflict`; no upstream write                                                                     |
| pending, uncertain, or terminal failed receipt replay                                        | never repeat the write; prove the exact desired state where possible, otherwise `409 outcome_unknown` |
| simultaneous requests with the same old revision                                             | the first may write; the waiter rereads and returns `409 conflict` without writing                    |
| response loss but post-read exactly proves the desired name/order/delete                     | mark applied and return success                                                                       |
| post-read mismatch, timeout, disconnect, or network timing that cannot prove the side effect | mark uncertain and return `409 outcome_unknown`                                                       |
| deterministic upstream 10/50/70 before an ambiguous side effect                              | normalized invalid request/forbidden/not found; the receipt is terminal and replay does not write     |

Create cannot infer an unknown created resource ID after an ambiguous response. Delete replay may be confirmed when the target is absent and the persisted request fingerprint matches. No pending, uncertain, or failed operation is automatically retried.

Conflict and outcome-unknown responses include the readable current snapshot when one is available, but never raw upstream messages, credentials, file paths, or unknown extension fields.

## Capabilities, residual risk, and compatibility

Authenticated server capability reports `playlists.read`, `playlists.write`, and, as of Step 05, `favorites.songs` as supported, allowed, and available. Resource `editable=false` still wins over the account-level playlist capability. All web `clientFeatures` remain false until their owning consumer Steps.

The preflight revision check, process-local queue, and post-write reconciliation expose known conflicts but cannot provide CAS against a native client that writes between the BFF read and upstream write. This native TOCTOU residual is intentional and is never hidden as transactional success.

Existing gonic `/rest`, Musiclatte native, bot, music/media/player routes, and source audio are unchanged. Live devserver mutation belongs to Phase 2 Step 11; Step 04 uses deterministic source-shaped fakes and performs no live write.

## Errors

All failures use the shared `{schemaVersion: 1, error: {code, retryable}}` envelope. Relevant mappings are `400 invalid_request`, `401 unauthenticated`, `403 forbidden`/`csrf_rejected`, `404 not_found`, `409 conflict`/`outcome_unknown`, `415 invalid_request`, `422 invalid_request`/`token_auth_unsupported`, and retryable `503 upstream_unavailable`. User-visible KO/EN clients translate the stable codes; upstream text is not exposed.

Verification evidence is recorded in [Step 04](../verification/phase-2/step-04.md).

## Step 08 web selection consumer

The web selection consumer sends append requests in stable source order and budgets the encoded
JSON operation envelope, revision, and song IDs together. Its 8KiB default is strictly below the
16KiB Fastify body limit and provides practical headroom when the BFF maps IDs into repeated
Subsonic query parameters. Each successful batch returns the detail revision required by the next
batch and receives a new operation ID. A failed batch stops the sequence; retry reuses that batch's
operation ID and revision, while already-applied IDs are removed from selection.

The playlist picker uses summaries only for presentation, then rereads chosen detail to enforce the
server's current `editable` and revision contract immediately before append. Create-new confirms an
empty playlist before starting the same append pipeline. Verification is recorded in
[Step 08](../verification/phase-2/step-08/README.md).
