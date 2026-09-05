# S09 media transport browser scenarios

Use the normal login entry with the synthetic S03 fixture, then open
`/__dev/audio-probe?songId=probe-song&coverId=probe-cover`.

| Scenario                   | Action                                                    | Expected evidence                                       |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Secret-free load           | Inspect audio and cover current URLs                      | Fixed `/api/v1/media/...` paths; empty query strings    |
| Native playback            | Activate the named Play control                           | Pause state appears and media time advances             |
| Seek                       | Focus the named time scrubber and use its keyboard action | `currentTime` changes while duration remains finite     |
| Cover                      | Wait for the named image                                  | Complete with nonzero natural width                     |
| Accessibility/localization | Inspect KO/EN labels and keyboard focus                   | Named native controls and matching localized copy       |
| Production boundary        | Build/preview and request `__dev/audio-probe`             | Module absent from assets/source map; route returns 404 |

Synthetic browser evidence does not replace live gonic header checks or S10 real iPhone Safari
player verification.
