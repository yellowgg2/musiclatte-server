# Artist information API

`ARTIST_INFO_ENABLED` is strict, opt-in, and defaults to false. When enabled, the authenticated
`GET /api/v1/music/artists/:id/info` route advertises `music.artistInfo`. The existing artist and
album routes are unchanged when the flag is on or off.

Each request first calls `getArtist` with the opaque route ID. This confirms that the tag artist is
visible to the current authenticated account and supplies the only accepted cover-art ID. The
service then calls `getArtistInfo2` with `count=20` and `includeNotPresent=false`. It never searches
by name, calls an external provider, stores provider credentials, or creates a local artist index.
Gonic remains the owner of provider configuration and its cache.

The response contains only the verified artist ID, optional plain biography text, optional
MusicBrainz ID, optional local cover-art ID, and bounded similar artist IDs/names. Markup, scripts,
styles, upstream image URLs, unknown fields, invalid similar records, self references, duplicates,
and blank names are discarded. A client may resolve `coverArtId` through the existing authenticated
same-origin cover proxy; arbitrary upstream image URLs never cross this API.

An empty successful `artistInfo2` response becomes `state: empty`. It does not claim that a provider
is absent or unsupported because gonic does not expose that distinction. HTTP, protocol, timeout,
and network failures use the existing API error envelope. The route uses `libraryRead`, so request
disconnect aborts the current upstream work and a session/policy change during I/O is checked before
the response. Reads are request-local: there is no persistent cache or response sharing between
accounts. Because enrichment is a separate route, its failure cannot block the basic artist album
response.

The web consumer requests enrichment only on an artist route when the capability is available.
`ArtistInfoPanel` owns its loading, empty, error, retry, and expansion state. An AbortController and
monotonic generation prevent a late A response from replacing artist B. Album rendering remains in
`MusicPage` independently. Artwork uses the player's existing same-origin cover URL builder, similar
artists link only by server-returned IDs, and React text rendering never injects biography markup.
