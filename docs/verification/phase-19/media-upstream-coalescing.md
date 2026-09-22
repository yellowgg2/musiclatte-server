# Phase 19 follow-up — media upstream identity coalescing

## Production observation

The one-hour production acceptance found short bursts of media `upstream_unavailable` responses
while playback and all service health checks remained stable. The safe gateway aggregate showed that
the failures completed in under 200 ms and did not match `storage_unavailable`. A favorites page can
load many covers concurrently, and each media request previously started its own upstream `getUser`
identity check before fetching the cover.

## RED → GREEN

RED proved that eight concurrent cover requests for one session produced eight concurrent upstream
identity checks. GREEN keeps one in-flight identity check per session and lets concurrent callers
share it. The result is not cached: after the in-flight check settles, the next request performs a
fresh identity check. Session state is still re-read after the network boundary. Subscriber-aware
cancellation preserves the shared check while another caller remains and aborts it when every caller
disconnects.

## Verification

- Focused RED: 1 failed assertion, received 8 identity requests instead of 1.
- Unit GREEN: `media-proxy`, `auth-api`, and `account-summary-api`; 61 tests passed.
- Contract GREEN: `media-transport`; 2 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

No public route, response schema, UI, locale, policy, database schema, or media file behavior changed.
Production deployment and a new observation window remain separate from this implementation result.
