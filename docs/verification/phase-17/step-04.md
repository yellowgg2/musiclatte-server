# Phase 17 Step 04 verification

## RED

- `npm run test:unit -- apps/web/test/metadata-single-ui.test.tsx apps/web/test/library-ui.test.tsx` collected 41 tests and failed four new assertions: the shared action did not request organization state, did not append state to its accessible name, had no non-color mark, and the Gallery exposed only two static metadata tiles.
- The focused contract test first required dedicated warning/info surface tokens with AA text contrast.

## GREEN

- `MetadataAction` consumes the provider-scoped organization store and exposes `data-organization-state` for loading, error, and all five ready states. Consumers without edit permission do not subscribe.
- Organized remains the existing white action. Needs-organization uses a dedicated warning surface, processing uses info, attention uses error, and unknown/loading/transport failure remain neutral. Every non-default state has an in-button `!`, `…`, or `?` mark without changing the 44px control.
- KO/EN accessible names append the user-facing state. The disclosure repeats that state as visible, non-live text before the independently announced metadata snapshot loading/error; organization transport failure has its own retry and never disables editing.
- The warning `#805315` on `#fff4dc` and info `#435e80` on `#eef5ff` pairs are enforced at or above WCAG AA normal-text contrast by contract test.
- The development Gallery uses the real providers and `MetadataAction` for organized, needs-organization, processing, attention, and unknown in both list and tile layouts. Its synthetic fetcher contains no account, credential, or library data.

## Browser and accessibility evidence

- Connected Chrome at `/__dev/gallery#music-row` exposed ten actual organization actions in the expected state order: five list rows followed by five tiles.
- At 1440×900, 1024×768, 390×844, and 320×844 CSS viewports, every metadata action measured 44×44px and both the page and `#music-row` measured zero horizontal overflow.
- Computed surfaces were white/default, warning `rgb(255, 244, 220)`, info `rgb(238, 245, 255)`, error `rgb(255, 243, 243)`, and white/neutral. The warning, processing, attention, and unknown marks remained visible independently of color.
- KO and EN accessibility trees included the full title plus localized organization outcome. At 320px, the expanded long-title warning disclosure measured 272px from x=3 to x=275, showed `File organization needed`, and retained zero page overflow.
- The selectable editable-playlist comparison remains in the first tile, so the list state matrix preserves readable title/metadata width while the existing six-action tile fixture remains covered.

Final user visual judgment, 200% zoom, color-blind simulation, touch, and cross-route convergence remain pending under `P17-UA-001–002`; they are not claimed as accepted here.

## Automated verification

- `npm run test:unit -- apps/web/test/metadata-single-ui.test.tsx apps/web/test/library-ui.test.tsx` — passed, 41 tests.
- `npm run test:unit -- apps/web/test/favorites-ui.test.tsx apps/web/test/playlist-read-ui.test.tsx apps/web/test/recent-ui.test.tsx apps/web/test/listening-ui.test.tsx apps/web/test/curation-ui.test.tsx` — passed, 40 tests.
- `npm run test:contract -- tests/contract/metadata-ui.test.ts tests/contract/library-ui.test.ts` — passed, 11 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed; the existing bundle-size warning remains non-blocking.
- `npm run format:check` — passed.
- `git diff --check` — passed.

No production deployment, credential access, or music-file mutation was performed.
