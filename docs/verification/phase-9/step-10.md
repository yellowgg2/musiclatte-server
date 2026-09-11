# Phase 9 S10 — Token settings and capability guidance

The existing Settings access-token panel now offers a feature-local Codex ID3 preset. The preset selects only `metadata:read`, `metadata:write`, and `media:organize`; it never issues a token. Selecting organization directly adds the required metadata scopes, while clearing it unlocks metadata write without silently clearing that explicit permission. Lyrics remains optional.

The panel renders the writer's advertised field list and explains that capability means Musiclatte can write a field, not that Codex automatically found or verified a value. Organization readiness distinguishes configured/available, worker unavailable, account denied, and permission unknown. Unsupported automation keeps the existing capability-gated panel behavior. Existing library, expiry, one-time secret, uncertain issuance, refresh, and revoke flows remain unchanged.

## TDD and automated verification

- RED: the two new Settings tests failed before the preset and guidance existed.
- GREEN: `apps/web/test/access-tokens-ui.test.tsx` — 7/7 passed.
- Settings/login regression plus locale parity: 4 files, 52/52 passed.
- Automation/capability/production exclusion contracts: 3 files, 40/40 passed.
- Typecheck, production build, and Prettier check passed.

The source-only automation UI harness served the production Router with synthetic data only. Browser checks covered KO/EN, keyboard traversal, preset scope state, one-time token display/hide, configured worker-unavailable, organization-denied, and token-manager-denied states. Layout measurements reported no horizontal overflow at 1440×900, 390×844, 320×844, or a 900×450 CSS-pixel viewport representing the 1800×900 page at 200% reflow. At 390px and 320px all controls stayed inside the viewport. No real token, account, library, or media metadata was used or recorded.

Final visual/discoverability review, actual Chrome 200% zoom, reduced motion, and the full user acceptance matrix remain owned by P9-UA-001.
