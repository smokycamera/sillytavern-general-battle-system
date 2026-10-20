# Release directory

The current installable extension is root `manifest.json` plus `dist/`. Read `package.json` and `docs/current-release.md` for the current product version.

- `native-candidate/` is temporary output from `npm run build:extension`; it may be removed after verification.
- `baselines/user-20260918/` is an immutable imported artifact used by historical replay and migration checks. It is not a current release or an installation source.
- `legacy-script-metadata.json` is only for the historical resident-loader build.
- Old ZIPs, screenshots and one-off probes belong in an external archive, not beside current release inputs.
