# MP3 metadata helper

The private Node client runs isolated Python through bounded JSON stdin/stdout. It uses the
existing process-group cancellation runner, a deadline capped at 60 seconds and a 1 MiB
response bound. Paths, tag values and lyrics are not command arguments or error logs.
`requirements-metadata.lock` pins Mutagen 1.48.1 and its wheel SHA256. Python 3.10+ is required.

`read` opens a descriptor-relative verified file and returns actual tags, a private full-file
digest and audio observations. `prepare` accepts a `.metadata-pending` candidate and expected
digest, mutates that candidate and rereads it. Step 04 owns candidate creation/ownership,
discard on failure, durable backup and final replacement. The suffix alone is not an ownership
proof; this helper is never exposed as an arbitrary public file-writing interface.

| Input                        | Behavior                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| MP3 ID3v2.3 / v2.4           | Preserve major version; load with `translate=False`                                 |
| MP3 without ID3              | Create v2.4 only upon explicit prepare                                              |
| ID3v2.2                      | Read-only `unsupported_tag_layout`                                                  |
| Corrupt/unpreservable layout | Reject with `unsupported_tag_layout` or closed invalid-metadata error               |
| M4A / FLAC / other audio     | Unsupported; audio codec must be MP3                                                |
| title / album                | TIT2 / TALB scalar set or clear                                                     |
| artist / albumArtist / genre | TPE1 / TPE2 / TCON complete text-array set or clear                                 |
| trackNumber                  | TRCK, positive n or n/total with total ≥ n                                          |
| year                         | TYER for v2.3, TDRC for v2.4; preserve valid date/time suffix                       |
| cover                        | Explicit type-3 description selector or unique new description; preserve other APIC |
| lyrics                       | Explicit USLT language + description; preserve other USLT and SYLT                  |

Omitted fields are unchanged. Explicit clear deletes only its target. Invalid leap-day changes
fail before writing. v2.3 multivalue text uses Mutagen's `v23_sep=None` to retain values; this is
an intentionally nonstandard ID3v2.3 representation, and other readers may expose only its first
value. No implicit upgrade or normalization is performed.

JPEG/PNG uploads require their real signature, ffprobe dimensions (≤16,000,000 pixels) and
successful FFmpeg decode. SVG/HTML and external image fetching are unsupported. Cover input is
≤8 MiB; text fields ≤4,096 code points; lyrics ≤100,000 code points and ≤256 KiB. The exported
protective defaults set batch size 64; Step 06 owns enforcing that operational limit, beneath
the schema's absolute ceiling of 100. An operator may lower limits. These are safety limits,
not throughput guarantees.

Before and after preparation, ordered MP3 audio packet sizes and SHA256 payload hashes,
codec/rate/channels/duration and successful full FFmpeg decode must match. Packet time offsets
are excluded. Known untouched frame semantic values and unknown frame raw bytes must match.
Existing ID3v1 bytes are retained exactly. Failure makes the candidate unusable for publication.
The original file is streamed, never loaded in full by the helper. Bounded tag/image buffers
are the only media payload held in memory.

Errors are closed codes: `file_unavailable`, `read_unstable`, `file_too_large`,
`invalid_metadata`, `unsupported_tag_layout`, `unsupported_format`, `invalid_cover`,
`ambiguous_selector`, `revision_conflict`, `audio_mismatch`, `helper_unavailable`.
Step 06 must map private errors and snapshots to the public contract explicitly.

References: [Mutagen ID3 behavior](https://mutagen.readthedocs.io/en/latest/user/id3.html),
[frame API](https://mutagen.readthedocs.io/en/latest/api/id3_frames.html),
[pinned release](https://pypi.org/project/mutagen/1.48.1/).
