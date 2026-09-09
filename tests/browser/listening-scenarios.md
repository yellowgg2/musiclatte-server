# Listening normal-route preview

Start tests/support/listening-preview.ts with free PORT/WEB_PORT, then Vite with MUSICLATTE_PREVIEW_API_TARGET set to the matching loopback API origin. Authentication inputs remain in auth-harness, not evidence.

The preview serves an original two-second PCM tone and matching duration through the real API. Login → Music → Play random songs → Recent listening yields one qualified event. Play the same song again and verify two distinct history rows and top count2. PREVIEW_CONTROL=seed adds52 synthetic events (half older than7 days) for50+4 pagination and rolling-filter verification.

Modes: missing makes current song lookup return not-found; error returns503; loading stalls lookup; record-error injects a synthetic event-insert failure; uncertain drops a submitted upstream connection; unauthorized fails scrobble authentication. normal restores ordinary responses. Only disposable test storage is affected. Do not copy authentication query strings or real music into evidence.

Verify that missing songs retain dates/counts and disabled play controls, list errors retain the player, and recording errors coexist with ongoing playback. Repeat-one can exercise short audio continuously.401 returns to login and removes the player. Another synthetic account has empty private history. KO/EN controls and dates retain row identities. Final visual/VoiceOver/Safari acceptance remains deferred.
