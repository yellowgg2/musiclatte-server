# Subsonic compatibility — S01

S01 adds a server-side, read-only typed adapter for gonic v0.22.0. It exposes no HTTP routes. The source-derived synthetic fixtures and live metadata checks below do not replace S04 gateway/native or S09 media transport verification.

## Source evidence

- Official gonic tag `v0.22.0`, commit `5ae99e8af550e4d5cbd45a3b430419d32cb54aed`, read in an isolated temporary checkout.
- [Controller/auth/JSON writer](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/ctrl.go): endpoint registration, `withUser`, `checkCredsToken`, `checkCredsBasic`, `writeResp`.
- [Common handlers](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_common.go): `ServeGetMusicFolders` line 137, `ServeStartScan` line 150, `ServeGetUser` line 177, `ServeNotFound` line 193, `ServeGetRandomSongs` line 321.
- [Folder handlers](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_by_folder.go), [tag handlers](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_by_tags.go), [wire schema](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/spec/spec.go): nil/omitted lists, integer music-folder IDs, string entity IDs, search count/offset and random filtering.
- [Subsonic standard](https://www.subsonic.org/pages/api.jsp): token parameters, repeated query encoding, wrapper and standard errors.
- Native read-only source: sibling `musiclatte` commit `3b49a0c3bb9ae401636842c7cf5af717d42af8bc`, `Musiclatte/Services/SubsonicEndpoint.swift`, `SubsonicClient.swift`, `Models/SubsonicPayloads.swift`. Apple workflow read; Serena unavailable in this session. Native worktree remained clean.

## Frozen native consumer manifest

Every path is origin-root `/rest/{endpoint}`, without requiring `.view`. Native uses `v=1.15.0`, `c=musiclatte`, `f=json`; BFF uses `c=musiclatte-web`.

| Native endpoint                                   | Parameters / meaning                                                                      | Preserve verification owner                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ping`                                            | Connection and standard errors                                                            | S01 fixtures; S04 native through gateway                          |
| `getMusicFolders`                                 | Configured music roots                                                                    | S01 adapter; S04 gateway                                          |
| `getIndexes`                                      | Optional `musicFolderId`                                                                  | S01 adapter; S04 gateway                                          |
| `getMusicDirectory`                               | Opaque `id`, folder/song children                                                         | S01 adapter; S04 gateway                                          |
| `search3`                                         | `query`, `artistCount`, `albumCount`, `songCount`                                         | S01 adapter; S04 gateway                                          |
| `getArtist`, `getAlbum`                           | Opaque `id`                                                                               | S01 adapter; S04 gateway                                          |
| `stream`                                          | Opaque `id`, native media URL                                                             | S01 request construction; S04 native; S09/S10 web bytes/player    |
| `getCoverArt`                                     | Opaque `id`, optional `size`                                                              | S01 request construction; S04/S09 transport                       |
| `getPlaylists`, `getStarred2`                     | Current account collections                                                               | S04 proxy preserve; P2 web consumer                               |
| `getPlaylist`, `deletePlaylist`, `star`, `unstar` | Opaque `id`                                                                               | S04 proxy preserve; P2 web consumer                               |
| `createPlaylist`                                  | `name`, ordered repeated `songId`                                                         | S01 encoding fixture; S04 proxy; P2 mutations                     |
| `updatePlaylist`                                  | `playlistId`, optional `name`, repeated `songIdToAdd`, position-based `songIndexToRemove` | S01 encoding fixture; S04 proxy; P2 mutations                     |
| `startScan`, `getScanStatus`                      | Admin-only scan initiation / scan state                                                   | Source evidence only in S01; S04 isolated stack and P3 management |

Native `fetch` performs a single token-to-enc retry on code 41 for metadata endpoints, and `ping` also contains its existing 41 handler. Native streaming/cover URL construction uses the current auth mode. This existing behavior remains unchanged. BFF accepts only `SubsonicTokenProof {username,t,s}`; it never retries raw/enc authentication. Proof generation and encrypted session storage belong to S02/S03.

`getUser` and `getRandomSongs` are new BFF consumers, not existing native endpoint enum cases. Random returns data only; no queue, playback, scan or collection mutation occurs.

## Adapter contract

- `createSubsonicClient({upstream,proof,timeoutMs,logger?})` returns `SubsonicClient`: `ping/currentUser/folders/indexes/directory/search/artist/album/random/mediaRequest`.
- The trusted upstream is a fixed HTTP(S) origin. Credentials, query, fragment and non-root path in configuration are rejected. Request arguments never select a destination or endpoint. Redirects are manual and rejected for metadata calls.
- Authentication uses `u/t/s/v/c/f`, no `p`. The proof is copied into a closure; mutation of the supplied object cannot alter later requests. Do not serialize the supplied options/proof or media Request: those are explicitly secret-bearing server-only inputs/outputs.
- `encodeParameters` uses ordered pairs and preserves repeated keys, duplicate values, Unicode and reserved characters. Typed adapter methods own all parameter names; this utility does not expose a generic network endpoint.
- `packages/contracts/src/subsonic.ts` defines domain types; `protocol.ts` validates unknown wrappers and payloads. Music-folder numeric IDs become decimal strings; all other IDs remain exact nonempty strings. IDs are never decoded as paths or numbers. Known optional media fields are validated, unknown upstream extension fields are omitted from the BFF projection.
- Required outer payload objects must exist. Omitted/null collection fields become `[]`, matching Go nil/omitempty responses. Invalid collection/item/identity shapes fail as `invalid_response`.
- `currentUser` uses returned nonempty `username` and boolean `adminRole`, and discards `folder`. Stock gonic returns a fixed folder array; it is not a per-user library ACL. The downstream session/policy owner must use returned identity rather than submitted aliases.
- All metadata calls accept abort signals; explicit positive `timeoutMs` covers headers and body reading. Timers/listeners are removed after settlement. Caller abort reasons, fetch causes, response bodies and upstream error messages never escape the boundary.
- Optional logger receives only operation, outcome, kind, numeric standard code and HTTP status. No URL, username, token, salt or query is logged. This guarantee applies to this adapter, not existing upstream/proxy logging configuration.
- `mediaRequest` creates a credential-bearing GET/HEAD `Request` for `stream/getCoverArt`, optional cover size and Range, fixed origin and manual redirects. It does not fetch media. S09 owns actual transport, cancellation lifetime, response headers, byte range and cache behavior; browser clients must receive secret-free BFF URLs.

## Error matrix

| Evidence                                         | Adapter kind                        | Interpretation                                                              |
| ------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------- |
| HTTP 200, standard 40                            | `authentication`                    | Credentials rejected                                                        |
| HTTP 200, standard 41                            | `token_auth_unsupported`            | This auth method unsupported; no BFF fallback                               |
| Standard 50                                      | `forbidden`                         | Operation denied, not unavailable                                           |
| Standard 70                                      | `not_found`                         | Target or endpoint absent; capability remains `unknown`                     |
| Standard 20/30                                   | `protocol_incompatible`             | Client/server protocol mismatch                                             |
| Standard 10                                      | `invalid_request`                   | Upstream rejected parameters                                                |
| Standard 0/unknown code                          | `upstream_error`                    | Preserve numeric code; do not invent unsupported status                     |
| HTTP non-2xx, including redirect/401/403/404/503 | `http_error` plus `httpStatus`      | Transport status wins over a nested wrapper; no inferred feature capability |
| HTML, malformed JSON/wrapper/payload             | `invalid_response`                  | Not an empty result or missing capability                                   |
| Network failure / timeout / cancellation         | `network` / `timeout` / `cancelled` | Distinct recovery signals, no raw cause                                     |

Stock gonic's unknown view and missing data both use 70. There is no general “unsupported endpoint” code that S01 can infer safely. The adapter retains `capability: unknown`; later capability owners need independent evidence. A valid empty response is successful supported data, not a failure.

## Verification boundary

`tests/contract/subsonic-parity.test.ts` uses synthetic source-shaped HTTP fixtures. Native write endpoints are enumerated and query encoding is checked, but neither a proxy nor native execution is claimed. The fixture server rejects write endpoints and non-GET requests.

Live devserver v0.22.0 passed 11 read-only checks using the compiled adapter over a session-owned SSH tunnel: ping, current user, roots, indexes, directory, search, artist, album, random, empty search, missing-directory 70. No personal metadata or auth values were persisted. No media bytes, scan, writes, gateway, real native or UI flow was exercised. See `docs/verification/phase-1/step-01.md`.

## S03 addition

S03 adds the explicit `SubsonicClient.startScan()` command through the existing fixed-origin/manual-redirect/error boundary. Only the authenticated, CSRF-protected `/api/v1/scan` route consumes it after current upstream adminRole and opt-in policy checks. Discovery never calls it. S01 read-only fixture behavior remains unchanged; a separate S03 HTTP harness verifies synthetic scan success/denial. Existing native `/rest` consumers are unchanged. See `auth-api.md` and `../verification/phase-1/step-03.md`.

## Phase 2 S01 collection adapter

Phase 2 S01 adds typed server-side collection methods without adding a BFF route or enabling a capability. `getPlaylists` returns `SubsonicPlaylistSummary[]`; `getPlaylist` and `createPlaylist` return a strict `SubsonicPlaylist`; `getStarred2` returns ordered `SubsonicStarredSongs`. `updatePlaylist`, `deletePlaylist`, `starSong`, and `unstarSong` return no raw wrapper.

Playlist summaries require nonempty opaque `id` and `owner`, a string `name`, RFC 3339 `created`/`changed`, and nonnegative safe-integer `songCount`/`duration`. Omitted `public` projects to `false`; an invalid or null value is rejected. Detail `entry` and starred2 `song` accept omitted/null as `[]`. Entries use the existing strict `MusicEntry` projection, so duplicates and source order remain intact while unknown upstream extension fields are discarded.

Mutation parameters are owned by explicit method options. New create encodes `name` followed by ordered repeated `songId`. Existing replacement encodes `playlistId`, `name`, then ordered repeated `songId`. Incremental update encodes `playlistId`, optional `name`, ordered repeated `songIdToAdd`, then ordered nonnegative `songIndexToRemove`. Delete and song star/unstar send exactly one opaque `id`. Every call continues to use GET, fixed origin/token proof, manual redirect handling, timeout/caller cancellation, and sanitized `SubsonicError`; no generic operation or credential-bearing URL is exposed.

`packages/test-support/src/collection-fixtures.ts` is synthetic and source-shaped. Collection reads/writes are enabled only by the explicit test scenario; the default Phase 1 fake still rejects arbitrary collection writes. No live playlist or star mutation was performed. See `../verification/phase-2/step-01.md`.
