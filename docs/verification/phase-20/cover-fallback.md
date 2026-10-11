# Loaded cover fallback regression

The API deliberately converted known Gonic cover decode failures into HTTP 200 empty SVGs.
Phase 20 hides the shared Artwork placeholder after a successful image load, so the empty SVG
removed the note from song tiles, the queue and playlist cards. A private production probe
confirmed one empty fallback among five sampled cover responses; no private identifiers were saved.

The API now renders the existing music-note geometry and accent inside the fallback SVG itself.
HTTP 200, image content type, private 60-second cache and fresh-cover no-store behavior remain
unchanged. Unknown upstream errors remain failures; real cover bytes and audio are unchanged.
There are no new UI strings, components, migrations or deployment configuration changes.

## Verification

- RED: the visible-note response assertion failed against the old empty SVG.
- GREEN: media proxy and design foundation unit tests, 39 passed; media transport contracts, 2 passed.
- Node 24.20.0/npm 11.19.0; repository typecheck, build and format check passed.
- Chrome normal login → playlists → detail tiles → play → queue: the note persists after image
  completion (`data-state=available`, image opacity 1), with missing-cover notes alongside it.
  The scoped synthetic decode failure allows audio playback and queue progression.
- Reproduction: playlist preview with `PREVIEW_CONTROL` containing `cover-undecodable`.
- Local screenshots: `artifact/phase-20/cover-fallback/` (ignored).
- Resolution Memory: troubleshoot returned no_results. Postflight no_new_solution: this is a
  project-specific static fallback representation correction; no canonical write or sync.
- Existing P20-UA-001/002/003 visual acceptance remains pending; automatic regression checks do
  not constitute final visual/device approval.
