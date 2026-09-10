# Phase 7 S13 — optional listening deployment

Node 24.20.0/npm 11.19.0 were used locally. The isolated devserver ran Linux 5.10 x86_64,
Docker 23.0.2, and Compose 2.17.2.

- RED: all three deployment contract tests failed because base flag pass-through, the listening
  overlay, and lifecycle documentation were absent. GREEN: base config resolves all five flags to
  false; the overlay resolves them to true while gonic, services, volumes, and worker count remain
  unchanged.
- The live stack used project `musiclatte-p7-s13-0910`, new volumes, ports 18535/18536, and two
  synthetic tagged MP3/FLAC files. Owner/config files were 0600. Existing demo and p5 acceptance
  containers remained running.
- Actual API→gonic checks passed: two songs, mix create/draw, one qualified event and identical
  replay receipt, gonic playCount delta 1, history/top, economy cold/warm/offset seek on 192kbps
  MP3, and artist info. A 98kbps FLAC truthfully selected original/native as already small.
- API restart retained history. Removing the overlay advertised all four optional capabilities as
  false and returned 404 for listening, quality-plan, and artist-info routes. Re-enabling restored
  the features with prior history intact.
- An online management snapshot was restored into a new private directory. Restored sessions were
  invalid and no `dispatching` or `not_sent` delivery remained replayable. The owned stack, images,
  volumes, source, synthetic media, private files, and tunnels were removed; ports are free.
- Focused unit 40 and deployment contract 21, typecheck, build, and format:check pass. Phase 7 implementation
  is complete; P7-UA-001–007 remain pending final user visual/accessibility review.
