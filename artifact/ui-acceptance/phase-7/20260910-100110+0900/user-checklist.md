# Phase 7 user validation — complete

User result received on 2026-09-10: all active iPhone Safari checks passed. VoiceOver remains
explicitly skipped and was not counted as passed. No further user validation remains for Phase 7.

P7-UA-001–005 passed. Run the following only on a fresh isolated fixture origin supplied for the
session; do not use an existing Musiclatte service or personal library. Record browser/OS/device and
whether each numbered check passed. These checks cannot be replaced by screenshots or automated AX.

The session routes are `/music/mixes/{fixture-id}`, `/music/history`, `/music/top`, `/settings`, and
`/music/artists/artist-1`. The launch handoff will provide the origin, login, and generated mix ID;
the fixture contains only synthetic music, long KO/EN text, a missing song, and controlled artist/
quality failures.

## P7-UA-006 — macOS VoiceOver

Skipped on 2026-09-10 at the user's explicit request. It was not executed and does not count as a
pass. Automated name/role/state evidence remains under `matrix/`, but it is not a substitute for
actual VoiceOver.

## P7-UA-007 — iPhone Safari

1. On the supplied isolated origin, log in and open the saved mix. At default text size, use touch to
   edit a condition with the software keyboard, dismiss it, draw again, Play now, seek, and Add to
   queue. Confirm controls remain reachable and the mini player does not cover the final item.
2. Background Safari for about 10 seconds and return. Confirm the same queue item and approximately
   the same playback position remain, then seek once more.
3. Open Recent listening and Frequently played. Confirm touch scrolling reaches the last row/action,
   period changes remain readable, and the missing-song row cannot be played.
4. Open Settings, change the next-track quality, start the next track, and confirm the current/next
   distinction remains understandable. Open the artist route, expand the biography, and follow the
   related artist link.
5. Close Safari completely, reopen the isolated origin, and inspect Recent listening. It is acceptable
   for an event interrupted by browser termination to be absent only when the UI explains the
   browser-close limitation; duplicate completed events or a misleading success claim fail the check.

Expected result: touch targets feel reliable, the software keyboard does not hide the active field or
primary action, playback/seek resumes without a queue reset, and all content works in KO and EN.

The user reported that all checks in this active Safari handoff worked. P7-UA-007 is passed. The
isolated origin was stopped after recording the result.

## Live iPhone Safari handoff — 2026-09-10

This fixture is available only while the current acceptance session remains open.

- Base URL: `http://192.168.129.108:18740`
- Username: `fixture-listener`
- Password: `synthetic-password`
- Saved mix: `/music/mixes/bd06972e-5979-4d8d-8ba3-104282f0f4a2`
- Recent listening: `/music/history`
- Frequently played: `/music/top`
- Playback quality: `/settings`
- Artist information: `/music/artists/ar-1`
- Updated Curation layout: `/music/curation`

The fixture contains synthetic data and a 2:05 synthetic audio file only. The iPhone and this Mac
must be on the same local network. A direct feature URL may initially return to All music after
login; use the top navigation or open the feature URL again.

Perform the P7-UA-007 checks above, then inspect Curation as the focused Phase 6 follow-up: confirm
that the top navigation, filter card, library-status card, and divided music list are easy to scan;
change one filter and confirm the final row remains reachable by touch while the player is visible.
This is a design/touch recheck of the changed layout, not a repeat of the previously accepted
metadata enrichment and conflict semantics.

VoiceOver is intentionally excluded by the user's request. Do not infer a VoiceOver pass from this
Safari check.

### Safari feedback fix — 2026-09-10

The live build was updated after the user found that the artist language controls stayed on the
left and that the listening refresh action stretched to the height of the label/select stack. Reload
the artist, Recent listening, and Frequently played routes before continuing. Confirm that the
artist edit-history/language utility group ends at the right content edge and that both refresh
actions now have the same normal control height as the adjacent buttons. The user confirmed all
three observations in the refreshed iPhone Safari build.

### Login foreground-return fix — 2026-09-10

Reload the login page before continuing the numbered checks. Enter temporary, non-secret text in
both the username and password fields without submitting it, switch to another app or tab, and then
return to Safari. Confirm that the login form never changes to a loading screen and both values are
still present. A logged-out `/api/v1/session` check may return 401 in Web Inspector; the failure is
that it clears the fields or replaces the form. Do not submit the temporary values. The user
confirmed the correct behavior in Safari; repeated logged-out 401 console entries were accepted as
diagnostic noise because the application state remained correct.
