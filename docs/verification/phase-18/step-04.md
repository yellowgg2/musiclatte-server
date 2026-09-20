# Phase 18 Step 04 verification

## Result

- The shared opened-file inspector validates a generic MP3 audio stream/format. The existing downloader still additionally requires the exact 11-character source comment.
- Admission requires two distinct observations, an unchanged fingerprint, and at least 10 seconds from `stableSinceAt`; all timing uses the injected clock.
- Validation opens with `O_NOFOLLOW | O_NONBLOCK`, requires a nonempty bounded regular single-link file, and compares the exact device/inode/size/mtimeNs/ctimeNs/link fingerprint before, during, after, and at the visible path.
- Invalid media receives a bounded retry and cannot hot-loop. A changed fingerprint resets attempt/failure/stability through inventory discovery.
- The admission transaction rechecks current owner instance/revision, observation lease/generation/fingerprint, and internal provenance before creating or reusing a MediaLink.
- A new path atomically receives an unavailable MediaLink, an `external` DownloadEvent timestamped by the admission clock, and a `registering` observation with both IDs.
- Import publish intents, Musiclatte events, metadata items, and organization source/target evidence close the observation as `internal_path` without an external event.

## RED → GREEN evidence

- RED: 4 admission tests failed because the external watch service did not exist.
- GREEN: admission, import worker, metadata boundary, and recent API focused tests passed 111/111.
- Existing import worker source-comment, invalid media, publication, migration, and crash recovery behavior remained green; the stale schema assertion was updated from v30 to the actual v31 migration head.

## Race and provenance matrix

| Case                                | Result                                                   |
| ----------------------------------- | -------------------------------------------------------- |
| one observation or <10 seconds      | deferred, no event                                       |
| valid stable generic MP3            | one external event, registering                          |
| corrupt/static invalid media        | settling with `invalid_media` backoff                    |
| fingerprint change                  | stable timer/failure/attempt reset                       |
| rename-over-open replacement        | `file_changed`, no event                                 |
| symlink/nonregular/empty/multi-link | rejected or changed before admission                     |
| import publish intent               | closed `internal_path`, no event                         |
| retry after committed admission     | observation no longer claimable; event count remains one |

No filename, tag, digest, absolute path, source bytes, identity key, or process stderr is added to public output.
