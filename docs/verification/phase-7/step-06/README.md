# Phase 7 S06 — listening player

Node24.20.0/npm11.19.0, repository root, base832972a. Implementation complete.

- RED: tracker2 and client1 assertions failed for missing boundaries. Actual PlayerProvider integration failed with zero recorded events at qualification before integration.
- `npm run test:unit -- apps/web/test/listening-tracker.test.ts apps/web/test/listening-player.test.tsx apps/web/test/player-ui.test.tsx apps/web/test/metadata-sync.test.tsx`:23 passed; added scope-fencing regression and final listening-player scope3 passed,24 across final scopes.
- `npm run test:contract -- tests/contract/listening-client.test.ts tests/contract/listening-api.test.ts`:6 passed.
- `npm run format`, `npm run typecheck`, `npm run build`, `npm run format:check`: exit0. Existing jsdom scrollTo diagnostic does not affect assertions.
- Deterministic clocks cover actual interval union, repeated regions, seek jumps, pause/waiting/source-load gaps, delayed updates, unknown duration and short tracks. Actual provider covers repeat-one distinct IDs, capability-off request0, recording failure preserving source/time/load/pause counts and account-generation abort/late-response fencing.
- Sender tests prove byte-identical retry, initial+3 maximum attempts, terminal uncertain handling,50-item cap,24h rejection and disposal abort. Existing player retry/media-error and metadata-sync regressions remain green.
- No new rendered controls, shared components, locale copy or Gallery states. S07 owns visible history/status and real Chrome end-to-end flow; S06's specified boundary is actual provider integration with deterministic media. P7-UA-007 device/browser-lifetime acceptance remains pending.
- Rulebook failed-audio reload safeguard retained and covered by existing player tests. Postflight skipped(no_new_lesson), no canonical writes. Test renderings, timers and request controllers disposed; no browser/server created by this Step.

## LAN HTTP event ID regression — 2026-09-11

- The devserver had listening enabled and a persistent management SQLite volume, but the admin
  account still had zero events. A real 202-second playback crossed the 50% threshold while the
  browser raised `TypeError: crypto.randomUUID is not a function`; no POST reached storage.
- RED added two tracker regressions: an insecure-context crypto surface without `randomUUID`, and
  a transient event-ID failure followed by another qualified sample. The focused file failed 2/6
  for those exact behaviors before the production change.
- GREEN replaces the secure-context-only UUID call with a 24-byte `crypto.getRandomValues`
  base64url ID accepted by the existing server contract. The tracker marks an occurrence sent only
  after ID creation and enqueue complete, so an ID failure remains retryable.
- `npm run test:unit -- apps/web/test/listening-tracker.test.ts
apps/web/test/listening-player.test.tsx apps/web/test/player-ui.test.tsx
apps/web/test/metadata-sync.test.tsx` passed 33/33. The focused listening contract command passed
  6/6; typecheck and the production build passed under Node 24.20.0/npm 11.19.0.
- The patched web image was rebuilt on the existing devserver LAN HTTP origin without replacing
  API, worker, gonic, or their volumes. A temporary six-second tagged MP3 produced one server event
  with `submitted` delivery and rendered in Recent listening. The new asset logged no browser
  error. The exact verification DB row and MP3 were removed, the immutable delete trigger was
  restored in the same transaction, gonic was rescanned, and final event/delivery counts returned
  to zero.
- No rendered UI, locale, shared component, API, schema, gonic source, or persistent user media
  changed. P7-UA-007 is stale only for a final user-operated iPhone Safari confirmation of this
  playback-capture delta.
