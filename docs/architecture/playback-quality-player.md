# Playback quality lifecycle

PlayerProvider still owns one Audio element. Optional quality selection has enabled, value and
account scope. Missing/disabled capability keeps the legacy synchronous URL path. Selection
is read only when starting a new queue occurrence; changing preference cannot reload audio.

A pending plan has its own AbortController/generation and recovery candidate. Until it succeeds,
active source, queue and position stay intact. The decoder accepts only the exact same-origin
stream path for the requested ID/profile and a coherent plan. Unknown metadata/unsupported
conversion remains an explicit reason; only already_small can transparently use the already
small original. Original recovery is an explicit context action forS10.

The active source holds plan, integer offset and native restore position. Offset seeks clamp to
whole seconds below duration, reload the same Audio resource and preserve listening occurrence.
Logical time is offset+media.currentTime; plan duration remains the full duration. Rapid seeks
retain explicit playback intent even while the previous load temporarily pauses the element.
Native restore applies again after metadata when necessary. Playing or metadata readiness gates
old source timing events. Premature offset ended becomes a media error instead of advancing queue.

New occurrences start listening accounting; seeks/retries/original recovery retain its interval
union and event identity. MediaSession receives absolute position and the same seek callbacks.
Stream errors retain position and expose explicit original recovery; a bounded plan read detects
expired authentication. play() rejection generations retain the established concrete media-error
precedence. Unmount aborts plan/probe/random requests and clears the owned Audio source.
