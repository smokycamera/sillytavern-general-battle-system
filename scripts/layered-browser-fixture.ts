import { writeFileSync, mkdirSync } from 'node:fs';
import { generatedLayeredField, generateUnit, SmallBattle, V11_OVERFLOW_D20 } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const units = (['ally', 'enemy'] as const).map((side, i) => {
  const u = generateUnit({name:i?'城内守军':'登城先锋',side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:i?'bow':'blunt',weaponLevel:3,armorTier:1,traits:i?[]:['siege-assault','water-crossing']},{seed:'browser-'+side,noVariance:true}).unit;
  u.id = side; u.morale=u.base.moraleMax=100; return u;
});
const storage = units.map(u=>unitRecordFromCombatant(u));
const field = generatedLayeredField('browser-layered',7,13,['siege'],{plan:{size:'standard',shape:'front',fortLevel:3,topology:'braid',landmarks:[{kind:'square',anchor:'core'},{kind:'tower',anchor:'inside_left'},{kind:'ruins',anchor:'inside_right'}]}});
const battle = new SmallBattle({battlefield:field,combatants:units,rules:V11_OVERFLOW_D20,seed:'browser-layered'}); battle.start();
const gate = battle.battlefield!.city!.gates[0]!;
battle.byId('ally').pos = gate + field.width; delete battle.byId('ally').elevation;
battle.byId('enemy').pos = field.city!.core[0]; delete battle.byId('enemy').elevation;
battle.turnOrder=['ally','enemy']; battle.turnIndex=0;
mkdirSync('artifacts/layered-browser',{recursive:true});
writeFileSync('artifacts/layered-browser/fixture.json',JSON.stringify({gate,state:{schemaVersion:2,storage,rosterIds:units.map(u=>u.id),autoTurn:false,protagonistId:'ally',field:'siege',lighting:'day',battle:{kind:'small',snap:battle.toSnapshot()}}}));
