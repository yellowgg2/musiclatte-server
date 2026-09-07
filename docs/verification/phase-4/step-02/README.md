# Phase 4 Step 02 — file binding and revision boundaries

Implemented 2026-09-08 from Step 01 commit `5ae2ae1` on
`yellowgg2/tdd/phase-4/step-02-file-binding-revision`. Node 24.20.0 / npm 11.19.0; the helper ran
with Python 3.11.15 in a project-specific venv outside Git. The host default Python was unchanged.
`METADATA_TEST_PYTHON` can select another explicit supported interpreter for tests.

## Behavior and evidence

- Strict independent metadata policy/config, explicit editor and restore-manager intersection,
  overlapping-root denial and read-only/worker availability distinction.
- Current-account HTTP fixture getSong/folder resolution for imported and legacy tracks,
  stable existing link reuse, no fabricated download events, changed-byte revision and revoked
  session/unauthorized/path mismatch rejection.
- Real temporary filesystem + Python subprocess: normal hash, parent/leaf symlink denial,
  hardlink/read-only diagnosis, root inode replacement rejection, and deterministic mutation
  during both bounded hashing attempts yielding `read_unstable`.
- Stable instance-key HMAC scopes file revision to canonical library/key/digest independently
  of login. The raw digest and path remain private resolver data for later explicit projection.
- Existing process runner gained bounded private text stdin; its descriptor-input and import
  worker behavior are preserved. New private metadata and Python runtime/cache patterns are
  excluded from Git and Docker contexts.

RED assertions covered absent boundary/config/resolver implementations and missing stdin text
behavior. Subsequent integration issues were corrected without weakening safety assertions:
the synthetic upstream folder ID is `0`, and the private helper returns exactly 12 fields.
Exact optional signal typing was corrected before the final typecheck. These routine fixture/
shape/typing adjustments do not constitute new reusable Rulebook lessons.

## Validation

All commands ran at this repository root with the pinned Node/npm toolchain.

| Command                                                                                                                                             | Result                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `npm run format`                                                                                                                                    | exit 0 before verification |
| `npm run test:unit -- apps/api/test/metadata-boundaries.test.ts apps/api/test/import-boundaries.test.ts apps/api/test/recent-downloads-api.test.ts` | 63 passed, 3 files, exit 0 |
| `npm run test:contract -- tests/contract/recent-downloads-api.test.ts tests/contract/library-api.test.ts`                                           | 11 passed, 2 files, exit 0 |
| `npm run typecheck`                                                                                                                                 | exit 0                     |
| `npm run build`                                                                                                                                     | exit 0                     |

The helper fixture is synthetic bytes, not proof of MP3 validity or tag roundtrip. Step 03 owns
real format/frames, Step 04 actual writer/ownership preservation and OS locks. No live music or
remote service was changed. Fixture HTTP servers, DBs, files and processes are cleaned by the
test harness. The isolated interpreter remains available for subsequent metadata steps.

No UI/locale/Gallery diff or review debt; existing KO/EN source keys were unchanged. Rulebook
lookup completed with no directly relevant compatible rule selected. Postflight outcome is
`skipped(no_new_lesson)`, no central write/sync. Vault Step/overview are synchronized separately
and excluded from the code commit. Project scope additions: bounded stdin in the existing runner
and ignore rules are required by this step's private helper/config boundary.

Additional compatibility: import worker 46/46 passed; production-exclusion contract 7/7 passed.
Final boundary 7/7 passed after a non-ASCII expected-revision regression exposed a byte-length
comparison error; hexadecimal validation now consistently produces `revision_conflict`.
Typecheck and build were rerun after that fix and both passed.
