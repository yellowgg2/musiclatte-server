# Phase 19 follow-up — media upstream diagnosis

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

The next production redeploy still reproduced exactly 26 failures among 94 favorite covers.
Serializing cover fetches, including the complete response body, did not change that count and
falsified the overload hypothesis. The serial limiter was therefore removed rather than retaining a
normal-path throughput regression.

A private in-container probe then requested the same 94 unique cover IDs directly from Gonic. All
94 responses used HTTP 200: 56 were JPEG, 12 were PNG, and the remaining 26 were JSON Subsonic
failure envelopes. Every JSON envelope used error code 0 and a message identifying a cover decode
failure. The API had correctly rejected JSON as media but had classified every such item-level
failure as a retryable upstream outage.

The final RED fixes that semantic boundary. A bounded 16 KiB parser recognizes only an HTTP 200
JSON Subsonic failure with code 0 whose message identifies both cover and decode. The first fix
mapped that item-level failure to sanitized `404 not_found`, but repeated album-cover occurrences
still produced one browser console error per image element. The follow-up returns a static,
transparent SVG with HTTP 200 and a private 60-second cache instead. The existing artwork music-note
placeholder remains visible beneath it without a failed image request. Unknown JSON, malformed
bodies, oversized bodies, and other media failures remain sanitized `503 upstream_unavailable`
responses. Upstream bodies and messages are never returned or logged.

## Verification

- Focused RED 1: received 8 concurrent identity requests instead of 1.
- Focused RED 2: received 2 sequential-wave identity requests instead of 1.
- Focused production falsification: cover serialization still returned the same 26 failures.
- Focused final RED 1: a known Gonic cover decode envelope returned 503 instead of an item fallback.
- Focused final RED 2: the item fallback returned 404 instead of a cacheable empty image.
- Unit GREEN: `media-proxy` covers concurrent sharing, sequential burst reuse, expiry, failure retry,
  subscriber cancellation, exact decode-error mapping, unknown-error preservation, and response
  sanitization.
- Production 5xx diagnostics record only the controlled route template, method, status, and public
  error code; request URLs, identifiers, headers, credentials, and upstream bodies remain excluded.
- Contract GREEN: `media-transport`; 2 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

No public route, UI copy, locale, policy, database schema, or media file changed. Only the media
representation of the known item-level Gonic cover decode failure changed.
