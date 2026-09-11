# Phase 9 Step 01 verification

- Implementation: complete — explicit `replaceAll` and `clearAll` cover variants preserve legacy selector set/clear behavior.
- Byte contract: real synthetic ID3v2.3/v2.4 MP3s retain version, audio packet identity, lyrics, unknown/non-APIC frames and ID3v1; replaceAll leaves one JPEG type-3 APIC and clearAll leaves none.
- Validation: replaceAll accepts only a decoded JPEG upload; PNG and malformed image payloads remain closed failures.
- Preview: destructive cover previews report per-target removed APIC count and the verified JPEG digest or null without exposing bytes or paths.
- Reflection: single-cover and no-cover states reuse the existing exact digest/no-cover verifier and cache probe.
- UI acceptance: not applicable.

## Automated evidence

- Runtime: Node 24.20.0, npm 11.19.0.
- Focused unit: `npm run test:unit -- apps/api/test/metadata-helper.test.ts apps/api/test/metadata-api.test.ts apps/api/test/metadata-backup-preview.test.ts apps/api/test/metadata-cover-cache.test.ts` — 25 passed.
- Focused contract: `npm run test:contract -- tests/contract/metadata-schema.test.ts tests/contract/metadata-api.test.ts` — 7 passed.
- Project gates: `npm run typecheck`, `npm run build`, `npm run format:check`.
