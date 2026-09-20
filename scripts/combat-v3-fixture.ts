import {generateUnit,SmallBattle,MassBattle,V3_D20,V3_TW,standardField,traitRegistry} from '../engine/src/index.js';
import {skillDefinitionId} from '../engine/src/skill-catalog.js';
import {unitRecordFromCombatant} from '../panel/src/unit-state.js';
import {prepareMassRoster} from '../panel/src/battle-setup.js';
const mass=process.argv.includes('--mass'),reg=traitRegistry();
const units=['A','D'].map((id)=>{
 const u=generateUnit({rulesVersion:'v2',name:id==='A'?'五百人射击编队':'敌方守备编队',side:id==='A'?'ally':'enemy',scale:'company',hpMax:500,level:5,weaponClass:'rifle',weaponLevel:5,armorTier:1,armorLevel:5,traits:[],abilityBlueprints:id==='A'?[{id:skillDefinitionId('物理单体射击')!,level:5}]:[]},{seed:id,registry:reg,noVariance:true}).unit;u.id=id;return u;
});
const storage=units.map(u=>unitRecordFromCombatant(u));
const battle=mass?new MassBattle({combatants:prepareMassRoster(units),rules:V3_TW,seed:'v3-browser',traitRegistry:reg,commanderId:'A'}):new SmallBattle({combatants:units,rules:V3_D20,seed:'v3-browser',traitRegistry:reg,battlefield:standardField()});
battle.start();if(battle instanceof SmallBattle){battle.turnOrder=['A','D'];battle.turnIndex=0;battle.byId('A').pos=42;battle.byId('D').pos=21;}
console.log(JSON.stringify({schemaVersion:2,factRevision:1,storage,rosterIds:['A','D'],protagonistId:'A',autoTurn:false,autoAllyOrders:false,mode:mass?'mass':'small',battle:{kind:mass?'mass':'small',snap:battle.toSnapshot()},autoSettleXp:true}));
