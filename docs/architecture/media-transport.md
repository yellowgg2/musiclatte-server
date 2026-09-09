# Authenticated media transport — S09

## Public boundary

- `GET|HEAD /api/v1/media/songs/:id/stream` serves audio.
- `GET|HEAD /api/v1/media/cover/:id` serves cover art.
- `packages/contracts/src/media.ts` owns the fixed same-origin route builders and request/response
  header allowlists. Opaque IDs are encoded as one path segment and are never interpreted as a
  filesystem path or destination URL.
- Browser URLs contain no Subsonic credential query. Cookie/bearer parsing and session identity
  verification happen before a media request is created.

## Upstream request and format policy

`proxyMedia` uses the existing server-only `SubsonicClient.mediaRequest`. It always targets the
configured gonic origin and carries the encrypted-session token proof only in the upstream
request. It forwards `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since`, requests
identity content encoding, rejects redirects, and never forwards arbitrary browser headers.

No `format` or transcode profile is added. Native gonic format selection remains authoritative.
The live v0.22.0 check returned both MP3 (`audio/mpeg`) and FLAC (`audio/flac`) unchanged. The
accepted stream types cover browser audio/video media plus `application/octet-stream` and
`application/ogg`; HTML, JSON, missing types, and wrong cover types fail closed.

## Response and lifetime

- Successful media statuses are `200`, `206`, conditional `304`, and unsatisfied-range `416`.
  Other redirects/errors are normalized to the existing secret-free API error shape. Media
  `401` revokes the stale session; `403`, `404`, and temporary upstream failures remain distinct.
- Only `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`,
  `Last-Modified`, `Cache-Control`, and `Expires` can cross the response boundary. Upstream
  `Location`, cookies, diagnostic headers, bodies, and messages cannot cross an error response.
- HEAD and empty 304/416 responses terminate without downloading a body while preserving the
  upstream length/range validators. Cover cache policy is not replaced by the global API
  `no-store` default when gonic supplies one.
- GET bodies are handed to Fastify as a Node `Readable` backed by the fetch stream. Node/Fastify
  own pipe backpressure; no array buffer or full-file accumulator exists in the production path.
  Browser abort/response close aborts the upstream fetch, while the configured timeout bounds
  headers only and does not terminate a healthy long playback body.
- The session is checked once more after upstream headers arrive so logout or policy invalidation
  during I/O cannot publish media.

## Development probe and compatibility

`/__dev/audio-probe` renders localized native audio controls and a cover image using the same
route builders. Query parameters contain opaque fixture IDs only. The module is guarded by
`import.meta.env.DEV`, excluded by Vite tree-shaking and the Docker context, and rejected by the
production preview middleware. It is a transport surface, not the S10 player or a Gallery/shared
component.

The origin-root `/rest/*` gateway and native clients are unchanged. Synthetic fixture provenance
is recorded in `packages/test-support/media/README.md`; live verification records only formats,
statuses, lengths, and allowed headers, never IDs, titles, credentials, queries, or media bytes.

## Phase 7: explicit playback quality

`STREAM_QUALITY_ENABLED` is strict, opt-in and defaults false. It enables the authenticated
`GET /api/v1/media/songs/:id/playback?quality=original|economy` plan and optional stream queries.
The qualityless legacy transport remains unchanged. `media/playback-plan.ts` validates the
latest song metadata and observes transcodeOffset v1 before offering economy offset seeking.
Original adds only format=raw; economy adds format=mp3,maxBitRate=128 and integer timeOffset.
Bitrate <=128 returns original/native with already_small. Missing positive bitrate/duration
returns metadata_unknown; missing extension returns offset_unsupported. These are explicit
unavailability reasons, not permission to silently fall back after a conversion fails.
The browser must handle these reasons before using an original stream path.

Economy stream requests repeat metadata/extension validation. Raw bypass conditions return
409 playback_plan_changed without streaming; offsets must be smaller than duration.
`quality-headers.ts` binds validators to quality/offset. An upstream ETag is wrapped; gonic's
Last-Modified-only response gets a representation ETag which maps back to conditional dates.
Mismatched If-Range drops Range, unbound date conditions are removed, and positive offsets
never reuse byte ranges. Qualityless validators are unmodified. Native and base warm-cache
200/206/304/416 and HEAD are preserved; cold transformations may be 200/chunked.
The proxy remains streaming with downstream-abort propagation and no transcoder in Node.

The isolated v0.22.0 live harness reads only a private0600 JSON via MUSICLATTE_P7_PRIVATE_CONFIG.
Its operator supplies an isolated, version/digest-verified container and exactly three synthetic
90-second files:64/256kbps MP3 and high-bitrate FLAC. Empty only that owned audio cache before
a cold probe. No production cache or library is inspected or cleared by the harness.
