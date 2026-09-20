# PR #2 / #3 follow-up review

PR #2's workflow trigger changes are incorporated with their original commit as a merge parent. PR #3 retains the two battle AI fixes and the 22 previously corrected unit-test expectations.

## Runtime fixes discovered in browser testing

- Builder and inventory text/number blur events must not make the entire document inert. Doing so interrupted focus transfer and could type the next field's value into the previous field. Draft capture remains synchronous; transactional actions retain their save guard.
- Failed builder saves now restore the editor's expanded state along with the pre-operation facts, keeping the existing preview available for retry.

## Historical smoke repairs

No smoke entry points or functional assertions were removed. Selectors now identify the intended command controls; lazily rendered workspaces and collapsed equipment/calculation controls are opened before interaction. Fixtures explicitly request a two-round control objective, enough entities for mass combat, free space for vanguard deployment, and an out-of-range target for stabilized short-move fire.

Rule expectations follow the current overflow D20 default, battle-XP participation share, half-step fatigue, three rally attempts, skill-v4.1 upgrade, anchored L8 artillery damage, and configured settlement prompt. Save failure rollback, source identity, ammunition, item consumption, reloads, reports, cross-chat isolation, and reload consistency remain checked.

## Validation and limits

- TypeScript and 719 unit/integration tests passed locally (no skipped tests).
- Frozen-release scenario and migration compatibility checks passed.
- Native browser smoke passed 27 checks under metadata-only and 27 under legacy-full save contracts.
- All 25 historical smoke entry points are required by CI; individual failures are printed directly in the job log. The packaging-ready flag now also requires the complete unit and historical browser suites.
- Native distribution is rebuilt from the reviewed source.
- Dependency audit is reported separately: production dependencies have zero findings; the existing development toolchain has five findings (three moderate, one high, one critical). Major Vite/Vitest upgrades are outside these fixes. Packaging no longer claims an audit was run merely because a build succeeded.
- Browser testing uses disposable simulated hosts; this follow-up did not run a fresh real SillyTavern/Tauri installation or access user chat saves.

The GitHub Actions run for the final commit is the authoritative complete check result.
