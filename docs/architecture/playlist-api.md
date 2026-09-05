# Playlist read API — Phase 2 Step 03

The playlist BFF is an authenticated, read-only projection over the configured gonic instance. Gonic remains the only playlist source of truth: the management database stores no playlist names, entries, covers, or snapshots.

## Routes and response projection

Both routes require the existing cookie or bearer session, reject every query parameter, return `schemaVersion: 1`, and use the shared `libraryRead` boundary for caller cancellation, current identity verification, post-read session recheck, and sanitized error mapping.

| Route                       | Upstream work           | Result                                                                                                            |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/playlists`     | one `getPlaylists` call | source-ordered summaries with `editable`, informational `revision`, and `coverState: fallback`                    |
| `GET /api/v1/playlists/:id` | one `getPlaylist` call  | ordered `{position, song}` occurrences, exact detail `revision`, `editable`, and first-playable-entry cover state |

Opaque playlist and song IDs are preserved as strings and encoded exactly once. The BFF does not expose the Subsonic wrapper, raw upstream messages, credential-bearing URLs, file paths, or unknown extension fields. Empty playlist lists and empty details are successful responses.

List reads never fan out to `getPlaylist`; gonic summaries do not contain cover IDs. Detail returns `coverState: available` and `coverArt` only when the first playable entry has a cover ID, otherwise it returns `coverState: fallback` without `coverArt`.

## Occurrences, revision, and editability

Duplicate song IDs remain distinct occurrences. A detail `[A, B, A]` is returned as positions 0, 1, and 2; clients must not use song ID alone as an occurrence key.

The server signs revisions with `SessionService.sign('playlist-revision', canonicalValue)`. The canonical JSON array contains instance ID, verified current username, playlist ID, name, changed timestamp, and either the exact ordered entry IDs for detail or `null` for a summary. The resulting base64url HMAC is opaque. Only a detail revision represents a mutation precondition; a summary revision is informational and cannot substitute for a detail read.

`editable` is true only when the verified identity username exactly equals the upstream playlist owner. A public or legacy playlist that gonic allows the current account to read remains readable, but another owner's resource is projected as non-editable. This signal does not replace the server-side write recheck in the mutation Step.

## Errors, capabilities, and compatibility

The existing normalized boundary maps missing/expired credentials and upstream authentication to 401, permission denial to 403, missing resources to 404, incompatible authentication/protocol to 422, and malformed/network/timeout failures to retryable 503. An authentication failure revokes the session; other upstream failures do not. A logout or policy change while the upstream read is pending prevents late success data from being returned.

`playlists.read` is supported, allowed, and available for an authenticated session. `playlists.write`, `favorites.songs`, and all web `clientFeatures` remain disabled until their owning Steps. Existing `/rest` gonic, Musiclatte native, bot, music BFF, and media behavior is unchanged.
