# Release channels

This repository uses two long-lived channels:

- `main` — stable/public channel.
- `test` — integration and hands-on testing channel.

## Normal development

1. Create a short-lived feature/fix branch.
2. Open the PR against `test`, not `main`.
3. After the PR is merged, **Test channel CI** runs the full test suite, rebuilds the native extension, verifies the installable output, and commits the generated `dist/` + root `manifest.json` back to `test`.
4. Test the `test` branch in SillyTavern / TauriTavern.
5. When the candidate is accepted, open a PR from **`test` → `main`**. No feature cherry-picking or reimplementation is needed.
6. Merge only after **Release channel gate** and the repository's normal **Native extension review** checks are green.

## Versioning

For true one-click promotion, the test branch should already carry the intended release version. Example:

- `main`: 1.6.1
- `test`: 1.6.2

The branch is the prerelease marker; the version does not need a `-beta` suffix. This lets the exact tested commit move to `main` unchanged.

## Emergency hotfixes

A production-only emergency fix may use `hotfix/*` → `main`. After it lands, immediately sync `main` back into `test` before normal development continues.

## Installation

Stable users install the repository normally and stay on `main`.

Test users install the same repository but select the `test` branch. Do not enable stable and test copies at the same time.

## Enforcement

GitHub Actions now:
- validates and packages every real update to `test`;
- keeps the committed test `dist/` synchronized with source;
- rejects ordinary feature PRs aimed directly at `main`;
- checks that `test` contains the current `main` and that its committed installable bundle matches source before promotion.

Repository-level branch protection/rulesets should additionally require the checks in GitHub Settings if hard server-side enforcement is desired.
