# S11 iPhone 12 Pro verification

Status: final acceptance registered separately; implementation complete. Earlier S09/S10 approvals are not S11 evidence.

Required target: actual iPhone 12 Pro. Musiclatte version: 1.8, confirmed by the user. iOS version: 26.6.1, confirmed by the user. Safari favorites entry: confirmed by the user screenshot on that iOS version; a separate Safari build number was not collected. Simulator or another model cannot substitute for this plan gate. Server: isolated gonic v0.22.0 with current API/web/metadata worker, generated synthetic tracks only.

## Prepared path (historical; isolated stack now cleaned up)

Use the isolated test gateway address provided in the conversation, on the same LAN. Credentials remain private and are not copied into this document. Search `S11 Studio`; the two original songs are restored. Playlist `S11 Synthetic repeats` contains A, B, A, and A is starred. No real library is changed.

1. Safari: play `S11 Studio one`. While it plays, change that song's title from desktop; check continued playback and seek. Refresh/re-enter to observe the new title and cover. Restore from the desktop edit history, wait for verified completion, then refresh and play the original again.
2. Safari: open a tag/lyrics editor, show the soft keyboard, type and reach the final textarea/save controls. Check focus and footer/player overlap. Cancel any unnecessary draft.
3. Existing Musiclatte: connect to the same gateway, search the synthetic tracks, open the repeated playlist and starred song, play/seek, then refresh/re-enter after edit and restore. Report whether title/cover refresh actually works and the exact successful refresh path.
4. Record changed-cover/cache behavior honestly. File USLT success does not establish lyric display support in the existing app. P5 revision-aware native cache work is not implemented here.

## Results

- [x] iPhone 12 Pro, iOS 26.6.1 (bundled Safari), Musiclatte 1.8 recorded.
- [ ] Safari playback/seek during desktop edit; refreshed metadata/cover after edit and restore.
- [ ] Safari soft keyboard, last field, footer and focus.
- [ ] Existing Musiclatte search/cover/playlist/star/playback after edit and restore.
- [ ] Actual refresh procedure and any native limitations recorded separately from server proof.
- [x] Owned synthetic resources cleaned after the completed observations; existing service/library preserved.

Codex server-only results: three verified restores; both original whole-file hashes, original tags/lyrics, indexed titles, playlist occurrences, star, cover responses and streams passed. These do not check any box above by themselves.

## User observations — 2026-09-08

The user confirmed iPhone 12 Pro, Musiclatte 1.8, and successful playback in that app. This establishes initial native playback only; edit/refresh/restore, playlist/star and Safari checks remain pending.

While the user reported playback, Codex changed the synthetic `S11 Studio one` title to `S11 iPhone check one`; the server job reached verified completion and retained restore availability. User observation of continued playback/seek and new-title refresh is pending. The file is currently changed for that observation and will be restored after it; the earlier three-restore baseline proof remains a separate completed test.

The user subsequently reported that playback continued normally, the currently playing song still displayed its previous title, and Favorites displayed the changed title. This is an observed native presentation limitation: current playback metadata did not update automatically in this flow. It is not evidence of a failed file write or failed server reflection. The exact Favorites refresh action and seek behavior were not reported. No native implementation change is made in S11. Original restoration was then requested; post-restore user observation remains pending.

The user reported iOS 26.6.1. Codex completed the title-check restore: server status verified, title `S11 Studio one`, and both whole-file hashes again matched the baseline. Post-restore native refresh/seek and Safari interaction remain pending.

The user confirmed the requested post-restore native checks as normal: original title in refreshed Favorites, playback/seek, and `S11 Synthetic repeats` occurrence order one → two → one. Safari favorites entry was shown in a user screenshot; playback in Safari was not yet reported.

The Safari screenshot exposed vertically misaligned metadata/favorite buttons at the left card edge. Chrome 390px reproduced the issue: button tops differed by 6px. The row now owns mobile action spacing, aligns the two actions to the right, removes the favorite-only padding, and uses a flex metadata wrapper to avoid baseline whitespace. Its mobile disclosure is anchored to the row action group, keeping it within narrow screen bounds. The isolated web image was updated; Safari reload verification is pending.

Final user response “어 잘되 이제” confirms the requested Safari alignment correction and initial playback. Remaining native/Safari checks moved to Phase 4 ui-acceptance P4-UA-005–008. They were not executed. The isolated test stack, generated music, playlist/star and owned resources have been cleaned up; existing services/media were preserved. The earlier test URL is no longer live.
