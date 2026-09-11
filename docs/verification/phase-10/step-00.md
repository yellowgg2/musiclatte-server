# Phase 10 Step 00 verification

- Implementation: complete — `collections:read` is an explicit PAT scope and requires
  `metadata:read`.
- Contract: the request schema derives its bound from the canonical scope list; strict token,
  option and list decoders roundtrip the new scope without adding it to existing tokens.
- Storage: the repository stores and restores the exact sorted scope set without a migration or
  implicit grant.
- Compatibility: ordinary favorites and playlist routes still reject PATs. Settings creation keeps
  the new scope hidden until the localized presentation work in Step 03, while existing tokens can
  still show the exact raw scope identifier.
- UI acceptance: not applicable for this Step; P10-UA-001 remains pending for Step 03.

## Automated evidence

- Runtime: Node 24.20.0, npm 11.19.0.
- RED: the new scope failed contract validation, API options/issuance and storage roundtrip before
  implementation.
- Focused unit: `npm run test:unit -- apps/api/test/access-token-api.test.ts apps/api/test/access-token-storage.test.ts apps/web/test/access-tokens-ui.test.tsx`
  — 27 passed.
- Focused contract: `npm run test:contract -- tests/contract/access-token-schema.test.ts tests/contract/access-token-api.test.ts tests/contract/automation-ui.test.ts`
  — 5 passed.
- Project gates: `npm run typecheck`, `npm run build`, `npm run format:check`, `git diff --check`.

## Rulebook

- Applied `typescript-audit-every-enforcement-boundary-for-cross-stage-exceptions-001` to verify
  contract, issuance, storage and ordinary-route boundaries independently.
- Postflight: `skipped(no_new_lesson)` — the stale migration-version assertion and enum-driven UI
  type propagation were immediate local fixes without a high-cost reusable lesson.
