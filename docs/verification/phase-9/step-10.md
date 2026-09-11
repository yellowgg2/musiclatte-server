# Phase 9 S10 — Token settings and capability guidance

The existing Settings access-token panel now offers a feature-local recommended preset. The preset selects only `metadata:read`, `metadata:write`, and `media:organize`; it never issues a token. Selecting organization directly adds the required metadata scopes, while clearing it unlocks metadata write without silently clearing that explicit permission. Lyrics remains optional.

The panel renders the writer's advertised field list and explains that capability means Musiclatte can write a field, not that its value was automatically researched or verified. Organization readiness distinguishes configured/available, worker unavailable, account denied, and permission unknown. Unsupported automation keeps the existing capability-gated panel behavior. Existing library, expiry, one-time secret, uncertain issuance, refresh, and revoke flows remain unchanged.

## TDD and automated verification

- RED: the two new Settings tests failed before the preset and guidance existed.
- GREEN: `apps/web/test/access-tokens-ui.test.tsx` — 7/7 passed.
- Settings/login regression plus locale parity: 4 files, 52/52 passed.
- Automation/capability/production exclusion contracts: 3 files, 40/40 passed.
- Typecheck, production build, and Prettier check passed.

The source-only automation UI harness served the production Router with synthetic data only. Browser checks covered KO/EN, keyboard traversal, preset scope state, one-time token display/hide, configured worker-unavailable, organization-denied, and token-manager-denied states. Layout measurements reported no horizontal overflow at 1440×900, 390×844, 320×844, or a 900×450 CSS-pixel viewport representing the 1800×900 page at 200% reflow. At 390px and 320px all controls stayed inside the viewport. No real token, account, library, or media metadata was used or recorded.

## UI wording follow-up — 2026-09-11

- User-visible Codex wording was removed from the access-token panel in both KO and EN.
- Each of the five permission choices now has a concise visible description connected with `aria-describedby` while preserving its short checkbox name.
- The library group explains that `music` is a Musiclatte library name and that the selected libraries bound the token's access.
- RED: the new focused test failed on the absent permission description.
- GREEN: focused web unit 3 files, 51/51; focused contract 3 files, 40/40.
- Connected Chrome production Router check: the preset selected read/edit/organize without lyrics, all five descriptions and the library boundary appeared in KO/EN, visible Codex text was absent, and document width equaled viewport width.

P9-UA-001 passed again with run `20260911-215239` on `main`/`origin/main` commit `24be3f0917162f09903784b90145a99a38998b21`. Connected Chrome 152 covered the affected KO/EN 1440/390/320, actual 200% zoom, keyboard, and accessibility-name/description matrix with FATAL 0, MAJOR 0, MINOR 0, and deferred UI debt 0. Evidence is retained under `artifact/ui-acceptance/phase-9/20260911-215239/`.
