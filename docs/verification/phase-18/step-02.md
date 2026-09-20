# Phase 18 Step 02 verification

## Result

- Import policy schema v1 remains exact-key compatible and projects `watchExternalMp3: false`.
- Schema v2 requires an exact boolean `watchExternalMp3` on every library. Watched libraries reject empty principals, dot principals, and case-normalized sanitized directory collisions.
- Import creation, recent downloads, and API startup use the same `importIdentityKey` byte projection.
- API startup signs owner identities while it owns the management key, then transactionally synchronizes the current instance/revision exact set. The worker receives only stored projections.
- Repository reads return `mismatch` with no owner details unless instance, revision, and expected account mappings match exactly.
- Removed, renamed, or disabled mappings are deleted; unchanged mappings update revision without discarding durable observations.

## RED → GREEN evidence

- RED: the focused unit run failed 6 assertions because schema v2, the identity helper, startup projection, and safe repository read did not exist.
- GREEN: `apps/api/test/import-boundaries.test.ts`, `external-watch-config.test.ts`, `auth-runtime.test.ts`, `recent-downloads-api.test.ts`, and `import-api.test.ts` passed 90/90.
- Existing external watch storage regression passed 3/3.
- Import/recent contract tests passed 5/5.

## Compatibility and security matrix

| Case                                                | Result                                 |
| --------------------------------------------------- | -------------------------------------- |
| schema v1 exact library keys                        | accepted; watch disabled               |
| schema v1 with watch key                            | rejected                               |
| schema v2 boolean true/false                        | accepted                               |
| schema v2 missing/non-boolean/unknown key           | rejected                               |
| watched library with no users                       | rejected                               |
| watched sanitized directory collision               | rejected before startup                |
| current instance/revision and exact expected owners | `ready`                                |
| stale instance/revision or renamed owner            | `mismatch`, empty owner list           |
| policy disable on restart                           | owner projection becomes empty         |
| worker secret surface                               | no signing key or management key added |

No username, identity key, signing key, policy file contents, or private response body is logged or added to a public fixture.
