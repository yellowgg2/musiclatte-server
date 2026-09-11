# Phase 9 Step 00 verification

- Implementation: complete — curation policy, claims, projections, filters and capability output use the canonical nine-field metadata contract.
- Storage: schema 022 rebuilds `curation_field_states`, preserves existing evidence/receipt/event identities and initializes albumArtist, trackNumber, year and genre as unknown.
- Compatibility: the strict decoder accepts current nine-field projections and normalizes legacy five-field projections with unknown states for newly introduced fields.
- Scope: required review remains title/artist; optional enrichment adds albumArtist, trackNumber, year and genre. Lyrics alone keeps its additional scope requirement.
- UI acceptance: not applicable for this Step; P9-UA-001 remains pending for the later Settings consumer.

## Automated evidence

- Runtime: Node 24.20.0, npm 11.19.0.
- Focused unit: `npm run test:unit -- apps/api/test/curation-storage.test.ts apps/api/test/curation-claims.test.ts apps/api/test/curation-reconciliation.test.ts` — 11 passed.
- Focused contract: `npm run test:contract -- tests/contract/curation-schema.test.ts tests/contract/capabilities.test.ts` — 30 passed.
- Project gates: `npm run typecheck`, `npm run build`, `npm run format:check`.
