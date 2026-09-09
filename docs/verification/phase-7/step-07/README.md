# Phase 7 S07 — listening web

Node24.20.0/npm11.19.0, repo root, base06a79e3. Implementation complete.

- RED: history UI absent and listening locale key count0 failed before implementation.
- `npm run test:unit -- apps/web/test/listening-ui.test.tsx apps/web/test/listening-player.test.tsx apps/web/test/player-ui.test.tsx`:14 passed.
- `npm run test:contract -- tests/contract/listening-ui.test.ts tests/contract/production-exclusion.test.ts`:9 passed.
- `npm run format`, `npm run typecheck`, `npm run build`, `npm run format:check`: exit0. Existing jsdom scrollTo diagnostics do not affect assertions.
- Actual page test retains two same-song events and a missing row without autoplay. Explicit play followed by filter refresh retains source,37-second position and load count. Rolling UTC preset bounds and KO/EN copy parity verified.
- Connected Chrome via CUA on isolated3107/5177, real Fastify/React with original2-second synthetic PCM and matching upstream duration. Login → random playback → history produced one actual qualified event; explicit replay yielded two distinct history rows and top2 plays.
- Synthetic52-event addition yielded50 first-page rows then54 unique rows total, no next cursor.7-day filter excluded8-day-old fixture rows (28 plays). Missing getSong retained54 count/date and disabled playback. KO/EN locale retained scope/controls and changed date display.503 displayed a list error while keeping the existing player.
- Synthetic recording INSERT failures during repeat-one showed nonblocking failure/pending copy while the actual Chrome player remained playing. During401 recording failure, Chrome returned to expired-session login and removed player. A second synthetic account showed empty private history with disabled play/add controls and no old queue.
- Build HMR reloads were excluded from preservation evidence; playback/error observations were repeated after build completion. Actual media/gonic fixture observations are distinct from unit37-second source assertions. No real gonic/native device claim.
- ListeningHistoryPage owns both routes, avoiding a redundant TopSongsPage wrapper. Existing shared symbols reused; Gallery baseline unchanged. Final P7-UA-002/005/006/007 pending. Owned preview processes stopped; the owned Chrome tab is retained for later Phase7 browser checks.
- Rulebook context checked; no new applicable capture candidate. Postflight skipped(no_new_lesson), no canonical writes.
