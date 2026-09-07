# Phase 4 S08 — Metadata synchronization and playback preservation

Implemented on `yellowgg2/tdd/phase-4/step-08-metadata-sync`, based on S07 `9461c5e`.

The strict metadata client, account/instance/policy-scoped polling store and current indexed-song projection refresh existing browse, favorites, playlists, recent downloads and player display data. Only verified same-ID changes update cover generations or song metadata. Pending and identity-conflict events remain status-only. No metadata product entry or client feature was enabled.

## Verification

Session-local Node 24.20.0 / npm 11.19.0; global runtimes unchanged.

- RED: missing strict client/current-song route and unsupported player refresh action failed assertions before implementation. Provider integration tests initially exposed missing visible refresh behavior.
- Playback/provider regression asserts unchanged audio src, currentTime, load/play counts, volume and shuffle ordering. Reducer coverage includes duplicate occurrences, source, repeat and removed optional display fields.
- Polling tests cover initial snapshot, cursor, foreground 3-second polling, hidden pause, 3/6/12/30-second backoff and late completion fencing. Snapshot, changes, upload and job transports reject obsolete generations even when fetch ignores AbortSignal.
- Existing browse selection retains stable IDs after refresh and announces zero selection when its final loaded row disappears. Favorites, playlist and recent UI consume verified indexed results. Recent refresh retains loaded pagination.
- Two regression corrections were verified: initial instance discovery no longer remounts the player; completion of an ordinary playlist mutation no longer issues an unsolicited read that overwrites its authoritative conflict snapshot.
- Final affected unit: **156 tests / 21 files passed** (all 20 web suites: 151; workspace locale/key/placeholder parity: 5). Contract: **23 tests / 8 files passed** (metadata-client, media-transport, recent-ui, playlist-ui, favorites-ui, library-ui, login-shell, workspace). No skips or zero-test filters.
- `npm run format`, `npm run typecheck`, `npm run build` and `npm run format:check` passed. jsdom reports unsupported native media/scroll methods in legacy harnesses; assertions use the controlled player fixtures.

## Additive producer and compatibility

`GET /api/v1/music/songs/:id` uses the existing authenticated library-read boundary and projects `schemaVersion: 1` plus a public `song`. It rejects query parameters and excludes private paths. The client strictly validates the same requested ID and reads current gonic metadata, never tag preview data. This narrow producer was necessary because the existing browse API did not expose exact-song refresh.

The metadata provider sits outside the player inside the session boundary. Account or known-instance replacement resets private state; initial capability discovery and policy changes preserve the active audio object. Policy changes invalidate requests/cursors/cover generations. Player updates only display fields and retains its existing imperative stream activation and failed-audio recovery behavior.

No new layout, control, localized string or component API was introduced. Existing approved SelectionBar remains visible while selection mode is active, including the empty refreshed result, so its existing live count communicates removal. Visible cover/editor review belongs to S09. KO/EN key/nonempty/placeholder parity is verified by the workspace unit suite. UI debt: 0 for this data-boundary step.

The S05 warmed gonic cover cache limitation remains: a saved file with unverified reflection cannot publish a new cover generation. No global cache clear, location reload, audio restart, replacement of conflicting IDs or download-event fabrication is used. Existing native/bot trees were not modified.

## Postflight

Reused `typescript-reload-failed-html-audio-resources-and-preserve-concrete-media-errors-001`: existing resume/load and concrete media-error/play-generation behavior remains covered by player UI regression tests. Rulebook postflight: `skipped(no_new_lesson)`; local effect/dependency corrections do not establish a new eligible high-cost lesson. Canonical write/index rebuild/research/sync: not applicable. No project lesson file was read or written.

No Git commands occurred inside the TDD implementation cycle. The separate authorized Git handoff follows completed gates; S09 then starts on a clean branch.
