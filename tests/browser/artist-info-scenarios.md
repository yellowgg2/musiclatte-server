# Artist information browser flow

Use the synthetic preview on the normal `/music/artists/artist-1` route.

1. Log in and confirm the albums section becomes usable independently of the information panel.
2. Confirm the same-origin artwork request, collapsed plain biography, Show more/Show less, and Moonlight local artist link.
3. Follow Moonlight, use browser Back, switch KO/EN, and confirm no automatic playback or player remount.
4. Set preview control to `info-empty`, then `info-error`; confirm truthful empty and retryable error states while albums remain.
5. Inspect DOM/network for absence of the fixture credential host and executable markup.
