# Phase 19 follow-up — media upstream identity coalescing

## Production observation

The one-hour production acceptance found short bursts of media `upstream_unavailable` responses
while playback and all service health checks remained stable. The safe gateway aggregate showed that
the failures completed in under 200 ms and did not match `storage_unavailable`. A favorites page can
load many covers concurrently, and each media request previously started its own upstream `getUser`
identity check before fetching the cover.

## RED → GREEN

The first RED proved that eight concurrent cover requests for one session produced eight concurrent
upstream identity checks. The first GREEN kept one in-flight identity check per session, but the
production browser split a large cover load into sequential connection waves and still reproduced
26 transient 503 responses after the service was healthy.

The follow-up RED proved that two sequential media waves still produced two upstream identity
checks. The final GREEN keeps in-flight coalescing and reuses only successful media identity results
for a five-second burst window. Failures are never cached, expired results revalidate, and non-media
requests continue to perform fresh checks. Session state is still read before and after the network
boundary, while logout, replacement, and upstream authentication rejection clear the burst entry.
Subscriber-aware cancellation preserves a shared in-flight check while another caller remains and
aborts it when every caller disconnects.

The first production redeploy still reproduced 26 failures among 94 favorite covers. That matched
the missing artwork count and showed that the remaining overload was the cover fetch itself, not
identity verification. A third RED proved that 12 HTTP/2 cover requests all fanned out to Gonic at
once. The final API path now admits at most six concurrent upstream cover-header requests, removes
aborted waiters, and releases permits on every success or failure. Audio streams use a separate path
and never wait behind cover art.

## Verification

- Focused RED 1: received 8 concurrent identity requests instead of 1.
- Focused RED 2: received 2 sequential-wave identity requests instead of 1.
- Focused RED 3: observed 12 concurrent upstream cover requests instead of at most 6.
- Unit GREEN: `media-proxy` covers concurrent sharing, sequential burst reuse, expiry, failure retry,
  subscriber cancellation, and bounded cover fan-out. `media-concurrency` covers queued aborts and
  idempotent permit release.
- Contract GREEN: `media-transport`; 2 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

No public route, response schema, UI, locale, policy, database schema, or media file behavior changed.
