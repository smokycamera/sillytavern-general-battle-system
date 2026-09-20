# Artillery LOS and enhancement totals — 0.2.0-rc.3

Ordinary direct fire and direct artillery now obey line of sight, including intervening ground units in V4. The former cannon exemption let direct artillery shoot through the front line and shields, contrary to its delivery mode.

- Keep `cannon` as the existing direct-artillery ID and rename its displayed class to 直射火炮. Add `indirect-cannon` / 曲射火炮, with a minimum range of 2 and the existing indirect-fire observation requirements. Generic 火炮 remains a direct-artillery alias; 榴弹炮 and 迫击炮 resolve to indirect artillery.
- Remove direct artillery's unit/shield and reserve-front-line exemptions. Indirect fire retains its observation, minimum-range, reload, and adjacency restrictions. Weapon-based skills use the selected weapon's LOS checks in both preview and execution.
- Both artillery types retain heavy-platform requirements, artillery HE/AP selection, damage budget, four-person gun-crew accounting, range projection, and reload behavior. The equipment selector, summaries, ammunition controls, protocol names, and bundled worldbook recognize both types.
- Preserve old weapons explicitly carrying `indirect: true`; do not infer their delivery from display names. The edit form shows such legacy artillery as indirect, keeps unchanged equipment frozen, and preserves indirect delivery when its recipe is edited.
- Remove only the aggregate enhancement limit. Each supported direction still accepts an integer from 1 through 10; duplicate and unknown directions remain invalid. Units, equipment, and skills may combine multiple +10 directions. Worldbook rules match validation.

Validation: TypeScript passed; all 734 tests across 98 files passed. Added coverage for direct/indirect obstruction, terrain with/without observers, skill execution, secondary weapons, snapshot round trips, legacy indirect flags, mass-battle orders, and unchanged artillery ammunition/damage rules. Protocol and edit/save tests cover aggregate enhancements over 10.

Frozen-release baseline scenarios and existing native/legacy save checks passed. These checks cover existing scenarios, not a promise that older app versions understand the new indirect-cannon recipe or newly permitted enhancement totals.

Browser validation: 35 native-extension checks passed using the metadata-only synthetic host. The 390px targeting smoke passed all four checks: ordinary direct fire blocked, direct artillery blocked, indirect artillery able to fire over the front line, and airborne shooting unchanged. No unhandled page errors. Real-device latency and host-specific persistence behavior remain subject to the limitations recorded for rc.2.
