# Quality normal-route browser verification

Resume pending actual Chrome checks after reconnecting its control extension. Use
`tests/support/quality-preview.ts`, PORT/WEB_PORT and optional MUSICLATTE_P7_PRIVATE_CONFIG
pointing to a0600 JSON. The private upstream must be an isolated v0.22.0 gonic with synthetic
high/low bitrate MP3 and FLAC; never use production cache. See S08 live harness prerequisites.
Use a free loopback API/web pair and MUSICLATTE_PREVIEW_API_TARGET for Vite.

1. Login, open a synthetic album and start a high-bitrate track with unset quality. Record the
   observed current player/time and sanitized preview format. Open Settings without navigation
   reload, select economy, confirm current source/time unchanged and next-track wording.
2. Activate the next high-bitrate track. Verify actual decoding/playing, economy badge and
   preview formatmp3. First empty-owned-cache request is cold200/chunked; later base Range is206.
3. Move the native range slider to the middle using keyboard; verify integer offset in sanitized
   preview output, absolute UI/MediaSession position and full duration. Seek near the end and
   observe actual ended advancing to the next queue occurrence.
4. Select original while economy plays, switch locale and confirm no reload/current-badge change.
   New occurrence uses original. A low-bitrate song shows already-small/original, not MP3 claims.
5. PREVIEW_CONTROL content error injects stream503 only; unknown removes song duration. Cause a
   new stream, verify explicit failure/reason and preserved position. Restore normal, choose
   Retry with original and verify resumed position without changing the economy preference.
6. Verify native radio name/role/checked, Tab/arrow/Space, recovery focus and player overlap.
   Reload/relogin same account retains preference; another account or instance remains separate.
   Mock/storage tests are additional evidence, not a substitute for actual Chrome playback.

Final visual/zoom/VoiceOver/Safari/device acceptance remains in Phase7 ui-acceptance.md.
