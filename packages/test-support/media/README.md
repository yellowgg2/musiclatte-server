# Synthetic media fixture provenance

The Step 09 transport fixtures are generated from source in
`packages/test-support/src/media-fixtures.ts`.

- Audio: an original two-second, mono, 8 kHz, 16-bit PCM WAV containing a 440 Hz sine tone.
- Cover: an original inline SVG made from basic geometric shapes.
- Author/source: generated for Musiclatte Server tests by the project; no downloaded, tagged,
  personal, or third-party media is included.
- Rights: project-owned synthetic test material, intended only for automated and development
  verification.

The fixture server derives Range responses from these bytes at runtime. No real library path,
metadata, credential, or upstream response body is copied into the repository.
