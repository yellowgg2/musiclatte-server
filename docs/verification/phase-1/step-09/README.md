# Step 09 verification — authenticated media transport

Date: 2026-09-05. Runtime: Node 24.20.0, npm 11.19.0, TypeScript 7.0.2, Fastify 5.12.3,
Vitest 5.0.0. Work branch: `yellowgg2/tdd/phase-1/step-09-media-transport`.

## Automated evidence

- RED: typecheck/build collected cleanly; the new unit file collected 14 tests and failed 13 on
  missing media routes, while the contract scope failed 4 assertions on the missing route
  builder, BFF route, and dev probe.
- Focused GREEN/REFACTOR: `apps/api/test/media-proxy.test.ts` 18/18; media transport plus
  production exclusion contract files 8/8.
- Broader: unit 188/188 across 14 files; contract 91/91 across 10 files; root typecheck and build
  passed. Production Vite output excluded the AudioProbe marker/source and returned 404 for the
  dev path. Git and Docker runtime-media exclusions explicitly retain the API transport source.
- Synthetic HTTP coverage: cookie guard, opaque ID encoding, no `format`/raw credential fallback,
  GET/HEAD, exact 206 bytes, 416 total length, request/cache validators, MIME allowlist, redirect
  and HTML sanitization, 401 revocation, 403/404/503 distinction, header timeout, first-chunk
  delivery, browser cancellation, and upstream socket close.
- Fixture provenance: original generated 2-second WAV and geometric SVG only; no downloaded or
  personal media. See `packages/test-support/media/README.md`.

## Chrome transport probe

Surface: connected Chrome 152.0.7977.82, actual viewport 1800×919 at device pixel ratio 2,
localhost Vite plus the real S03/S09 API and synthetic upstream.

1. Normal `/login` entry created a cookie session; navigation then opened
   `/__dev/audio-probe?songId=probe-song&coverId=probe-cover`.
2. Accessibility state exposed the localized native play/pause button, named audio time scrubber,
   named cover image, and KO language control. Audio reached `readyState=4`, duration 2 seconds;
   cover completed with nonzero natural width.
3. The audio and cover current URLs were `/api/v1/media/...` with empty query strings. Clicking
   native Play advanced to ended/paused, and keyboard focus plus Right on the time scrubber moved
   `currentTime` from 0 to 0.02 seconds.
4. This was MICRO transport verification only: no screenshot-based product design claim, shared
   component change, Gallery approval, or S10 player evidence.

## Live gonic v0.22.0 evidence

The existing devserver container, service, volume, and music library were preserved. A temporary
SSH tunnel and disposable local session store connected the S09 BFF to the fixed upstream; all
session resources and the tunnel were removed afterward.

- MP3 remained `audio/mpeg`; FLAC remained `audio/flac`. Both returned HEAD 200 with zero body and
  upstream length, then Range `bytes=0-1023` as 206 with exactly 1024 bytes, `Content-Range`,
  `Accept-Ranges`, and `Last-Modified` preserved.
- Cover returned HEAD 200 as `image/jpeg` with zero body, length, `Accept-Ranges`, `Last-Modified`,
  and `Cache-Control: public, max-age=1209600` preserved. One sampled conditional request returned
  200, so the implementation does not claim gonic always emits 304; the synthetic 304 response is
  verified as a pass-through.
- No format/transcode parameter, media byte, library ID/title/path, credential, or auth query was
  recorded. No music CRUD, tag edit, scan, deployment, native code change, or existing process
  replacement occurred.

## Gate result

UI class/action: MICRO / UI_SANITY_CHECK plus automation-capable UI_TEST. No new shared symbol,
Gallery state, baseline approval, manual UI requirement, or review debt. KO/EN gained four matching
nonempty probe keys. S09 transport is complete; actual product player UX and iPhone Safari audio
remain S10 owners.
