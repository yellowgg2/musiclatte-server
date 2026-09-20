# Phase 18 Step 05 verification

## Result

- External registration uses the same durable singleton scan coordinator and exact-path lookup as import registration. A due import `registering` item always wins coordinator acquisition.
- One external cycle leases at most 50 observations, joins an already-running scan, and shares the scan plus directory lookup cache across same- and different-library targets.
- Exact-path lookup remains rooted in each configured `musicFolderId` and `relativeRoot`; title, tag, and cached-ID guesses are never used.
- Completion atomically updates the MediaLink binding/availability, external DownloadEvent `registered_at`, and observation state only after rechecking the lease generation, event/media/path identity, fingerprint, and current regular-file presence.
- Existing different Gonic bindings are preserved as `registration_conflict`. Missing, ambiguous, malformed, wrong-library, timeout, cancellation, and upstream cases retain their event and a closed failure code.
- Registration retry starts at 30 seconds, doubles by registration attempt, and caps at one hour. Admission attempts are reset before registration so they do not inflate the first delay.
- Restart after database reopen respects the stored retry time and resumes without creating a second event or scan cycle.
- The existing recent projection returns registered external events as `ready` and retains deleted external files as `missing` without deleting history.

## RED → GREEN evidence

- RED: the external registration suite failed 3/3 because `createExternalRegistrationService` did not exist.
- GREEN: the expanded external registration matrix passed 16/16.
- The prescribed affected unit suite passed 139/139; the recent API contract suite passed 2/2.
- External watch storage/admission/registration regression passed 21/21.
- Typecheck, production build, and formatting checks passed.

## Scan, retry, and restart matrix

| Case                                      | Result                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| zero external target                      | no scan, `runOnce=false`                               |
| 1/N targets                               | one shared scan, exact IDs, atomic ready rows          |
| 51 targets                                | 50 claimed, one left durable for a later cycle         |
| targets from two libraries                | one coordinator cycle, library-scoped exact lookup     |
| import target due                         | external yields without upstream requests              |
| already scanning                          | joins without `startScan`                              |
| missing / ambiguous / malformed path      | closed retry code, event retained                      |
| wrong configured library / upstream error | `registration_path` / `registration_upstream`          |
| timeout / cancellation                    | lease released, durable retry, no duplicate completion |
| conflicting existing song ID              | binding unchanged, `registration_conflict`             |
| file deleted before completion            | event retained, no MediaLink registration              |
| event update failure                      | MediaLink update rolled back in the same transaction   |
| database reopen after backoff             | no early scan; one event resumes after the due time    |

The injected scan client remains the fixed worker credential boundary. Tests and public documentation contain only synthetic paths and IDs.
