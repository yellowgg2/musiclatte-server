# Media scan settings and playlist alignment — 2026-09-09

Implementation complete. Default automatic scanning is off; enabling uses360 minutes (6 hours).
Administrators can trigger a scan and change the persisted interval. Other users see permission
explanation. Playlist content uses the shell width, a compact title and an aligned action row.

## Automated evidence

Repository-local Node24.20.0/npm11.19.0; no global runtime changes.

- RED: fresh schedule-table assertion failed before implementation.
- `npm run test:unit -- apps/api/test apps/web/test/scan-settings-ui.test.tsx apps/web/test/playlist-read-ui.test.tsx apps/web/test/engine-settings-ui.test.tsx apps/web/test/login-shell.test.tsx`: **550 passed / 39 files**, exit0.
- `npm run test:contract -- --exclude tests/contract/gateway-parity.test.ts`: **150 passed / 24 files**, exit0.
  Gateway Docker tests remain excluded because the local daemon is unavailable (previous run's failure documented in account-imports.md).
- `npm run typecheck`, `npm run build`, `npm run format`, `npm run format:check`, `git diff --check`: exit0.
- Tests cover encrypted credential storage, six-hour due time, durable competing scheduler claims,
  disabling, permission loss, active scan coalescing, interval bounds, transient failure retry spacing,
  API admin/CSRF guards, migration, browser save/request payloads and existing playlist flows.
- Chrome through CUA, temporary local Vite5184 fixture mounting production components: KO default360
  observed; toggle → save confirmed; Scan now → requested/scanning confirmed. Production PlaylistsPage
  with synthetic summaries visually showed full available width and aligned compact title.
  Temporary HTML/TSX, tab and Vite process were removed. No fixture shipped.

Shared Action/TextField/StatusSurface/PlaylistCard and existing tokens reused. New scan panel is
feature-local. KO/EN keys match. Architecture documented in `docs/architecture/media-scan.md`;
Obsidian design system and unplanned acceptance index synchronized outside repository commits.
No applicable new central Rulebook lesson; postflight skipped(no_new_lesson), no canonical write/sync.

Final visual/zoom/reflow/VoiceOver acceptance remains pending:
`<Obsidian project>/specific-plan/ui-acceptance.md`: SCAN-UA-001, SCAN-UA-002, PLAYLIST-UA-001.
Automated browser evidence is not physical accessibility or user acceptance.
