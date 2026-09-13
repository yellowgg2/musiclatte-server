# Phase 17 Step 07 verification

## Scope

- Extended `musiclatte-id3-organize` to support an explicitly requested current-PAT-principal unorganized-library sweep without broadening vague requests.
- Routed detailed parent/shard capture, exact resume, live preflight, failure ownership, stop, final verification, aggregate reporting, and Telegram rules through a dedicated progressive-disclosure reference.
- Preserved the existing single-song, favorites, owned-playlist, earliest-release research, licensed-cover, required/optional metadata, organization, and multi-account reference contracts.
- Added the sweep command lifecycle to the canonical repository operator runbook.

## RED and dry-workflow evidence

- The pre-edit skill audit had no `unorganized` entry mode or sweep reference even though the S06 CLI existed; the installed-skill contract initially rejected the revised frontmatter when it no longer preserved the legacy one-song-or-collection discovery phrase.
- The final installed-skill contract verifies the legacy batch routing table and commands plus discoverability of `unorganized-sweep.md`, all three sweep commands, explicit-scope language, non-adoption, and non-success terminal-summary semantics.
- Synthetic CLI fixtures cover an empty complete selection with zero status/mutation requests, a 1,001-item two-shard capture, parent/child interruption and exact replay, malformed/partial capture refusal, live organized/processing/attention/unknown races with zero job requests, same-child resume, expiry/scope stop, and different-PAT rejection.

## Skill validation

- Canonical skill: `/Users/incredibleyoung/codex-config/skills/musiclatte-id3-organize`
- Canonical skill commit: `acdf42d26f78a293a4a099a671dcc8a65ead2ef7`
- `SKILL.md` frontmatter, `agents/openai.yaml`, generated Skill Catalog, and the new reference agree on the explicit current-account sweep scope.
- `quick_validate.py` passed with the configured PyYAML virtual environment.
- Skill repository Gitignore inspection found no generated/private artifact to exclude. The staged formatter skipped six Markdown/YAML files because that repository has no matching formatter configuration.
- Rulebook postflight: `skipped(no_new_lesson)`; the only new issue was a low-cost frontmatter compatibility wording adjustment already covered by the installed-skill contract.

## Commands

```sh
export PATH="/Users/incredibleyoung/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
npm run format
npm run test:contract -- tests/contract/id3-organize-sweep.test.ts
npm run test:contract -- tests/contract/id3-organize-batch.test.ts tests/contract/id3-organize-client.test.ts tests/contract/id3-organize-reference-guard.test.ts
/Users/incredibleyoung/codex-config/.venvs/skill-validate/bin/python /Users/incredibleyoung/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/incredibleyoung/codex-config/skills/musiclatte-id3-organize
npm run typecheck
npm run build
npm run format:check
git diff --check
```

All checks passed on 2026-09-14 with Node 24.20.0 and npm 11.19.0. The build retained only the existing Vite large-chunk warning. No production deployment, credential access, Gonic request, metadata/organization job, or real music-file operation was performed.
