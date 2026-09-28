# V9 tactical skill economy review

Base: `2363bdbd75e1844c0af1e71420e8e5e6cfce2881` (1.3.15). Candidate: 1.3.16.

## Changes

- Price SP expenditure using discounted next-activation attack opportunities in addition to the existing resource quote. Costs, cooldown groups, uses and natural recovery come from the actual unit/skill rules.
- Compare a rested next activation with an ordinary next activation. Natural recovery and cooldown decay happen after both: they are not exclusive rewards for doing nothing.
- Cache bounded forecasts inside one observation/decision; do not consume RNG or inspect hidden enemy orders. No random skill rotation, damage changes or artificial repeat cooldown.
- Keep old resource models and non-SP/energy-transfer pricing unchanged. Respect current damage, friendly healing, control, duplicate buffs and terminal-attack utility.

## Validation

15 regression cases pass. Switching the two battle AI call sites back to the exact base produces 6 integration failures: unnecessary holds in both modes while cooldown or natural SP recovery would advance after attacking too. Existing full baseline: 1263 cases, 1255 passed, 8 failed. After PR #49 was opened, the complete suite ran: 1278 cases, 1270 passed, the same eight failures and no new failure. Four old LOS fixtures incorrectly treated a human ally as an equal-height obstacle for a vehicle, contradicting the existing height rule. Those fixtures now use an equal-height large blocker, with two extra tests ensuring a vehicle can still fire over a human. One parser diagnostic expectation now checks the actual supported warning. Re-run: **1280 cases, 1277 passed, 3 failed**, none skipped. The three remaining fixed numerical V5/V6 replay expectations were already failing on the exact base and were NOT overwritten.

The new `scripts/audit-ai-economy.ts` covers 210 base/single-modifier mechanisms, L1-L10 and both battle modes (4200 decision scenarios), plus 240 level/loadout matches and 40 supplied-fixture matches. It checks legal orders, immutable previews, progress, HP/SP/fatigue bounds, cooldown/uses, formation counts, and includes mid-battle restoration. Run without sharding or pass `--shard=0/4` through `3/4`; `--myth-only` isolates the supplied fixture. Results are written to `artifacts/ai-review/matrix-*.json`. Final execution results and outstanding non-AI checks are recorded in PR #49; the coverage definition is not a claim that arbitrary multi-effect combinations or live external LLMs have been exhausted.

The supplied flying Sun Wukong / Erlang sample is also a validation fixture, not a promise to make all five skills equally frequent. Permanent flying makes a redundant flight buff worthless. Beneficial repeated attacks are deliberately still possible.
