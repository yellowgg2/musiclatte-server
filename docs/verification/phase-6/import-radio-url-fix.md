# Selected-video links copied from a YouTube mix

The API and web input parsers rejected `list` and `index` before downloader execution. Both now discard validated playlist context when the URL identifies an individual video. Playlist-only, channel, redirect, duplicate-parameter and malformed-context links still fail closed. Canonical identity, duplicate admission and the downloader's `--no-playlist` behavior remain single-video operations.

The user-reported watch/mix URL reproduced failures in producer, web input and API admission tests (RED: 3 failures). GREEN covers canonical replay and the production Router form submitting exactly one canonical video URL. KO/EN help and invalid-input text distinguish a selected video from a playlist-only URL.

Verification: affected import boundary/API/input/Router/worker unit tests; import API/UI contracts; typecheck, build and formatting. On 2026-09-09, the isolated devserver worker image with pinned yt-dlp 2026.08.19 successfully downloaded the selected video and converted it to MP3 (exit 0, one output, no downloader error). It used the same canonical single-video target and `--no-playlist`; the downloaded media and private diagnostics remain outside Git and are removed with the owned probe resources. No existing service has been redeployed as part of this source fix.
