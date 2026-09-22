# Phase 19 Step 06 — Operations and deployment handoff

## Delivered contract

- The runbook separates preflight, owner-only matched backup, source update, version-aligned recreate,
  seven-key compatibility, eight-key policy transition, post-deploy observation, and rollback.
- It preserves the full production overlay order, 30-day session age, six-hour Gonic scan, six-hour
  external safety traversal, 60-second curation cooldown, and 30-day curation sweep as distinct
  settings.
- Binary rollback restores matched pre-deploy data into fresh volumes. It does not let old code
  resume a process-local staged scan, edit continuation rows, delete volumes, or mutate either music
  library.
- The local diagnostic remains outside HTTP routes and Compose, opens the database read-only, and
  receives no Docker socket, credential, secret mount, or writable API music mount.

## RED → GREEN

The documentation contract RED found no version-aligned overlay/config/rollback handoff in the
background-load runbook. GREEN binds the exact example pacing values and required operational
phrases while production-exclusion coverage confirms the probe did not become a route or privileged
container surface.

## Scope statement

Affected verification passed: 4 unit files / 32 tests and 4 contract files / 28 tests, followed by
`npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check`.

Only repository documentation and synthetic automated contracts were exercised. No production
checkout, private policy, container, database, volume, DNS, credential, or music file was changed.
Production deployment and P19-UA-001 remain pending separate authorization.
