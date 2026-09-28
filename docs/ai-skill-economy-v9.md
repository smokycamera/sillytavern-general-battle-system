# V9 tactical skill economy review

Base: `2363bdbd75e1844c0af1e71420e8e5e6cfce2881` (1.3.15). Candidate: 1.3.16.

## Changes

- Price SP expenditure using discounted next-activation attack opportunities in addition to the existing resource quote. Costs, cooldown groups, uses and natural recovery come from the actual unit/skill rules.
- Compare a rested next activation with an ordinary next activation. Natural recovery and cooldown decay happen after both: they are not exclusive rewards for doing nothing.
- Cache bounded forecasts inside one observation/decision; do not consume RNG or inspect hidden enemy orders. No random skill rotation, damage changes or artificial repeat cooldown.
- Keep old resource models and non-SP/energy-transfer pricing unchanged. Respect current damage, friendly healing, control, duplicate buffs and terminal-attack utility.

## Initial validation

15 regression cases pass. Switching the two battle AI call sites back to the exact base produces 6 integration failures: unnecessary holds in both modes while cooldown or natural SP recovery would advance after attacking too. Existing full baseline: 1263 cases, 1255 passed, 8 failed. Full post-PR AI and integration review will be recorded here after execution.

The supplied flying Sun Wukong / Erlang sample is also a validation fixture, not a promise to make all five skills equally frequent. Permanent flying makes a redundant flight buff worthless. Beneficial repeated attacks are deliberately still possible.
