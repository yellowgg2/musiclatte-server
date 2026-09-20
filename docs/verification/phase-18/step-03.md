# Phase 18 Step 03 verification

## Result

- Inventory starts only at the exact `<relativeRoot>/<accountDirectory>` directory and never enumerates sibling account/public roots.
- Every scan validates the account root and each opened directory with no-follow identity checks. Symlink files/directories, non-regular files, and non-MP3 extensions are ignored.
- A versioned continuation stores only account-root-relative directory keys and offsets. Entry and elapsed-time budgets persist that continuation before yielding, and a recreated inventory resumes it.
- Initial discoveries remain `baseline`; only paths first seen after atomic baseline completion become `settling`.
- Filesystem nanosecond fingerprints are bound into SQLite as exact integers and decoded as decimal strings, avoiding unsafe JavaScript number coercion.
- Fingerprint changes reset stable/retry state. Unseen settling rows become `absent` at scan completion and may settle again only before admission; baseline/rejected/admitted paths remain path-once.
- Missing, unreadable, and replaced roots close with bounded codes (`root_unavailable`, `entry_unreadable`, `root_replaced`) and no absolute path or filename diagnostic.

## RED → GREEN evidence

- RED: 5 inventory tests failed because the inventory boundary did not exist.
- GREEN: the specified inventory/boundary/storage suite passed 25/25.
- Additional backup/restore regression passed; the expanded focused run passed 33/33.

## Filesystem matrix

| Case                                       | Result                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| empty account root                         | baseline completes atomically                               |
| nested Unicode `.mp3` / `.MP3`             | baseline or settling according to root state                |
| non-MP3 / symlink file / symlink directory | ignored                                                     |
| sibling/public directory                   | never enumerated                                            |
| missing account root                       | blocked, retryable                                          |
| unreadable directory                       | continuation retained, blocked                              |
| account root inode replacement             | sticky `root_replaced`, no new observation                  |
| 40-file tree with 7-entry budget           | persisted continuation, restart resumes to 40 baseline rows |
| elapsed budget before entry budget         | yields `progress` before consuming the tree                 |
| settling fingerprint change                | stable time and retry state reset                           |
| settling disappearance/reappearance        | `absent` then a fresh settling interval                     |
| baseline/rejected same-path replacement    | never promoted                                              |

No file contents, absolute host paths, media metadata, account identity key, or credential is written to logs or public fixtures.
