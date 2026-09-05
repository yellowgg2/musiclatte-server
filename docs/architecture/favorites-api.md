# Song Favorites API — Phase 2 Step 05

The favorites BFF is an authenticated set-state boundary over gonic `star`, `unstar`, and `getStarred2`. Gonic remains the only source of truth. The management database and playlist operation receipts store no favorite state.

## Routes and wire contract

| Route                             | Input                | Success                                                        |
| --------------------------------- | -------------------- | -------------------------------------------------------------- |
| `GET /api/v1/favorites/songs`     | no query             | `schemaVersion: 1` and current-account songs in upstream order |
| `PUT /api/v1/favorites/songs/:id` | `{starred: boolean}` | reconciled `id`, boolean state, and the song when starred      |

The schemas reject unknown query and body fields without coercion. IDs are opaque strings and are encoded once when sent upstream. Omitted or null `starred2.song` is a successful empty list.

Every route requires the existing cookie or bearer session and revalidates the current upstream identity. Cookie PUT requests additionally require JSON, the configured Origin, `X-Musiclatte-Client: web`, and the session-bound CSRF token. Disconnect and timeout signals propagate to the upstream request, and the session is checked again before returning success.

## Set-state reconciliation

Each PUT issues exactly one `star` or `unstar` call and then reads `getStarred2` for the same verified account. Repeating the same desired state is safe and creates no duplicate favorite or operation receipt.

| Post-write observation                       | Result                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| requested ID is present after `star`         | `200`, `starred: true`, with the authoritative song        |
| requested ID is absent after `unstar`        | `200`, `starred: false`                                    |
| requested ID is absent after `star`          | `404 not_found`; covers unknown/non-song silent no-op      |
| requested ID is still present after `unstar` | `409 outcome_unknown`; optimistic success is not claimed   |
| post-write read cannot complete              | normalized auth/permission/compatibility/unavailable error |

The service does not parse IDs to guess entity type. Only exact presence in the current account's starred song list proves the desired state. A late opposite request returns its own reconciled server result; web generation and rollback ownership remains Phase 2 Step 10.

## Isolation, capability, and compatibility

The Subsonic proof username selects the account-scoped upstream state. No favorite cache is shared between sessions or accounts. Synthetic two-account tests prove that a star written by one identity is absent from the other identity's GET result.

Authenticated capabilities report `favorites.songs` as supported, allowed, and available. Web `clientFeatures` remain false until the Step 10 consumer, so this producer does not expose a UI by itself.

Existing gonic `/rest`, Musiclatte native, playlist routes and receipts, bot, management schema, and source media are unchanged. Live web/native round-trip verification remains Phase 2 Step 11.

## Errors

All failures use the shared `{schemaVersion: 1, error: {code, retryable}}` envelope. Relevant mappings are `400/415 invalid_request`, `401 unauthenticated`, `403 forbidden`/`csrf_rejected`, `404 not_found`, `409 outcome_unknown`, `422 upstream_incompatible`/`token_auth_unsupported`, and retryable `503 upstream_unavailable`. Raw upstream messages, credentials, request URLs, and song metadata are not logged or reflected.

Verification evidence is recorded in [Step 05](../verification/phase-2/step-05.md).
