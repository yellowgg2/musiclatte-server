# Phase 9 Step 02 verification

- RED: the new automation policy mapping was rejected and the organization planner module did not
  exist.
- GREEN: explicit account mapping validation and the mutation-free `id3-managed-v1` planner were
  implemented.
- Unit: `automation-config.test.ts` and `organization-path.test.ts` — 19/19 passed.
- Contract: `automation-deployment.test.ts` — 3/3 passed, including the real HTTP/MP3 regression.
- Security: account/library boundaries, canonical music root, regular source, symlink parents,
  normalized collisions, and credential-free example configuration are covered.
- Mutation check: the ready-path test proves the planner did not create `ID3-managed`.
- UI, Gallery, localization, and browser checks: not applicable; this Step adds no product UI or
  user-facing copy.
- Rulebook: the compatible Node/deployment alignment rule is satisfied by Node 24.20.0; postflight
  is `skipped(no_new_lesson)`.

Final gates: project formatting, focused tests, typecheck, build, `format:check`, and
`git diff --check`.

## Source-account boundary follow-up — 2026-09-12

- A configured PAT operator may organize a song stored below another configured account directory
  in the same allowed library.
- The planner derives the destination account from the source key, so an `admin/...` source remains
  below `admin/ID3-managed/...` even when a `yellowgg2` operator submits it.
- The API planner and metadata worker reuse the same account-scope guard; a target under the
  operator's different account is rejected before filesystem work.
- Deployment was intentionally excluded.

## Case-only managed-directory recovery — 2026-09-22

- RED reproduced a production preview conflict where the verified metadata requested an NFC-stable
  uppercase artist directory while one equivalent mixed-case managed directory already existed.
- The planner now reuses the unique existing spelling for intermediate directories and records that
  canonical spelling in the target key. It does not create a second case alias.
- Equivalent final filenames remain `destination_conflict`; Unicode-normalization variants,
  ambiguity, symlinks, non-directories, and account/root boundaries remain rejected.
- Focused unit verification covers ready-path reuse, case-equivalent final-file rejection, and a
  managed-source `no_op`. Production replay uses the original frozen journal, revision, operation,
  and reference snapshots; no direct media or database mutation is permitted.
- Verification: path/config unit 27/27, file-store/state unit 15/15, API/worker unit 28/28, affected
  ID3 client/batch contract 52/52, automation deployment contract 5/5, typecheck, build,
  `format:check`, and `git diff --check` passed on Node 24.20.0.
