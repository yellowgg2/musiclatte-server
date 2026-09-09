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
