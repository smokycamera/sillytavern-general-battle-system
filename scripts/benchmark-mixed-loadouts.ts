// Run with vite-node scripts/benchmark-mixed-loadouts.ts (optional unit counts as arguments).
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { SmallBattle, standardField, V43_OVERFLOW_D20 } from '../engine/src/index.js';
import { batchWeapons } from '../engine/src/equipment-batches.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage } from '../panel/src/narrative-state.js';
import { prepareBattleItems } from '../panel/src/battle-items.js';
import { smallCommandChoices } from '../panel/src/llm-command.js';

for (const count of (process.argv.length > 2 ? process.argv.slice(2).map(Number) : [8, 32])) {
  if (![8, 32].includes(count)) throw Error('Supported unit counts: 8, 32');
  const equipment = 'scale="company" hpMax="50" level="4" weapon="佩剑:剑L3×40,长矛:长兵器L3×20,步枪:步枪L4×25,弓:弓L3×15" armor="皮甲:轻甲L2×25,铁甲:中甲L3×15" skills="斩击:物理单体L3+近战,瞄准:物理单体L3+射击,鼓舞:buffL3+士气L3" items="手雷:物理范围L3+投射×20,治疗药水:buffL3+治疗L3×10"';
  const text = '<tb>\n' + ['ally','enemy'].map(side => '<spawn name="'+side+'" side="'+side+'" count="'+count/2+'" '+equipment+'/>').join('\n') + '\n</tb>';
  const source = { characterId:'c', chatId:'bench', branchId:'main', messageId:'1', swipeId:'0', role:'assistant' as const, complete:true, generationId:'mixed', text };
  const ns = namespaceOf(source), binding = captureGeneration({}, ns, source.generationId);
  binding.complete = true;
  const proposal = proposalFromMessage(source, binding)!;
  proposal.id = "mixed-loadouts-" + count;
  const save = prepareNarrativeTransaction({}, proposal, ns, true);
  const template = prepareBattleItems(save.storage!.map(r => r.snapshot!), save);
  if (template.length !== count || template.some(u => batchWeapons(u).length !== 4 || u.carriedItems?.length !== 2 || u.abilities.filter(a=>!a.itemSourceId).length !== 3)) throw Error('Unexpected loadout');
  const rows = [];
  for (let trial = -1; trial < 3; trial++) {
    const combatants = structuredClone(template), field = standardField(13, 19);
    field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
    const battle = new SmallBattle({ combatants, battlefield:field, rules:V43_OVERFLOW_D20, seed:'mixed-benchmark' });
    battle.start();
    combatants.forEach((u, i) => {
      const n = i % (count / 2);
      u.pos = (u.side === 'ally' ? 10 + Math.floor(n/8) : 6 - Math.floor(n/8)) * 13 + 2 + n % 8;
    });
    battle.turnOrder = combatants.map(u=>u.id); battle.turnIndex = 0;
    const actor = combatants[0]!;
    const start = performance.now(), choices = smallCommandChoices(battle, actor.id), split = performance.now();
    battle.autoAction(actor.id);
    const end = performance.now();
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,12);
    if (trial >= 0) rows.push({ choicesMs:split-start, aiMs:end-split, choices:choices.length, menu:digest(choices), state:digest(battle.toSnapshot()) });
  }
  console.log(JSON.stringify({count, rows}));
}
