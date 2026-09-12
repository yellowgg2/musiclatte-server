# Phase 15 Step 01 verification

- A metadata batch item that fails before file publication can be retried by its original PAT
  through the existing child-job endpoint.
- Another PAT remains unable to read or retry the original item.
- The operator client accepts only a server-advertised unsaved retry, derives a stable replay-safe
  retry intent, and atomically checkpoints the child job in the same metadata step.
- An organization replay that has already succeeded is checkpointed once without a duplicate
  terminal journal transition.
- Cookie retry behavior remains covered by the existing metadata API suite.

## Automated evidence

- `npm run test:unit -- apps/api/test/automation-writes.test.ts apps/api/test/metadata-api.test.ts`
  — 19 passed.
- `npm run test:contract -- tests/contract/id3-organize-client.test.ts tests/contract/id3-organize-batch.test.ts`
  — 35 passed.
- Typecheck, build, formatting, and live recovery evidence are recorded after deployment.

Private PATs, item identifiers, media paths, manifests, and runtime journals are excluded from this
artifact and from Git.
