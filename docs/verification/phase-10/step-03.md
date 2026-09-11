# Phase 10 Step 03 verification

Implemented the server-advertised collection scope in Settings without widening the existing
single-song organization preset.

- RED: the focused UI tests could not find the collection checkbox, and the KO/EN contract found
  no collection label or description.
- GREEN: 15 focused access-token UI tests and 4 automation UI contract tests pass.
- The checkbox is rendered only when options advertise `collections:read`, exposes linked
  accessible name/description IDs, supports keyboard selection, and preserves the required
  `metadata:read` dependency.
- Validation blocks submission without a library. Explicit selection sends exactly
  `metadata:read + collections:read`; the recommended organization preset still sends exactly
  `metadata:read + metadata:write + media:organize`.
- Existing shrink-safe fieldset/help CSS and the one-column `40rem` breakpoint cover narrow and
  200% zoom layouts without changing shared primitives, global tokens, or Gallery.
- Typecheck, production build, format check, and `git diff --check` pass. Vite reports only its
  pre-existing large-chunk advisory.
- Agent Rulebook postflight: `skipped(no_new_lesson)`; no reusable cross-project lesson was added.
