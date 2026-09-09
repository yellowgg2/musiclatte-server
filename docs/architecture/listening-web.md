# Listening history and frequently played

One feature-local ListeningHistoryPage renders /music/history and /music/top using kind. The API history id is a stable opaque event hash; the reader maps it to the row key, keeping repeated song IDs as separate events. Top rows use songId. Current metadata is not persisted in the browser ledger. Missing songs retain timestamps/counts and disable playback without guessing titles or substituting another track.

All-time omits range parameters.7/30-day presets freeze exact rolling UTC elapsed ranges on explicit refresh/filter change; locale only changes date display. Signed next pages retain the original range and cursor. Initial/loading/empty/error, additional-page errors and invalid cursor reset have distinct states. Loaded songs supply explicit play and queue append, including repeated history occurrences. Filter/page/locale/metadata changes never call audio activation.

MetadataSync refreshes only affected visible song IDs without changing event keys. A confirmed local listening receipt refreshes the visible history/top snapshot. Pending and failed/dropped recording are nonblocking status text. Upstream uncertainty appears only inside expandable help, with no resubmit action. Copy identifies the web-only scope and exclusions from downloads/native/global totals.

The existing Action/StatusSurface/LanguagePicker/MusicRow/Artwork are reused without API or Gallery-state changes. New layout is feature-local. The client feature entry is enabled only with the local producer capability; bottom navigation remains unchanged. Final P7-UA-002/005/006/007 acceptance remains pending.
