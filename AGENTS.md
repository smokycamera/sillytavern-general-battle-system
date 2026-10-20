# Working in this repository

- Read `package.json` for the current product version and `docs/current-release.md` for the current release. The release version and the battle rules version are separate concepts; ongoing battles retain their saved rules.
- The maintained implementation lives in `engine/src`, `panel/src`, `host/src`, `runtime/src`, and `extension/src`. The installed entry is root `manifest.json` plus `dist/`.
- Build the native extension with `npm run build:extension`; check the committed bundle with `npm run verify:dist`. Keep the package version, lockfile, extension template, README release labels and generated manifests consistent.
- Follow `docs/release-channels.md`: feature/fix PR into `test`, then promote the same verified `test` build into `main`. Avoid publishing from an old checkout.
- `docs/history/` contains historical reports and superseded proposals. `release/baselines/user-20260918/` is an immutable regression fixture, not an installable release. Historical loader scripts and `vitest.baseline.config.ts` exist for migration/replay checks only.
- Before editing or publishing, check `git status`, `git branch -vv`, `git fetch origin`, and the source/bundle version. Do not infer the current version from a dated document, ZIP filename, old branch or worktree.
- Preserve unrelated changes. Clean up temporary files and generated candidates after verification. Back up unique local changes before retiring a worktree; verify the absolute target before deletion or moving directories.
- Run checks relevant to the change and the release gates. Do not add redundant tests or expand the known-failure allowlist to bypass a new failure.

User working preferences:

- Infer the goal and act through completion; ask only when missing information materially affects the result, and carry forward authorization.
- Prepare concrete, reviewable changes before requesting any necessary approval. Avoid unsolicited warnings and approval flows.
- Explicit user requirements override advisory skill guidance. If a skill blocks work, identify the exact file and applicable quoted requirement.
- Changes to prompts, dynamic context templates, and worldbook instructions must be presented with their exact proposed content and confirmed by the user before applying them. Parser compatibility and other implementation work may proceed independently while confirmation is pending.
