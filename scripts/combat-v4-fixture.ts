import {generateUnit,traitRegistry,prepareCombatModel,V4_D20,V4_TW,SmallBattle,MassBattle,standardField,SeededRng,applyCombatDamage} from '../engine/src/index.js';
import {unitRecordFromCombatant} from '../panel/src/unit-state.js';
import {prepareInventoryState} from '../panel/src/inventory-state.js';
import {captureBattleArchive,captureBattleStart} from '../panel/src/report-history.js';
const mass=process.argv.includes('--mass'),registry=traitRegistry();
const units=['A','D','C'].map(id=>{
 const u=generateUnit({rulesVersion:'v2',name:id==='A'?'L6重型火炮车':id==='D'?'十二名重甲食人魔':'十二辆车辆编队',side:id==='D'?'enemy':'ally',scale:id==='A'?'hero':'company',body:id==='D'?'large':'vehicle',level:4,weaponClass:id==='A'?'cannon':id==='D'?'sword':'rifle',weaponLevel:id==='A'?6:4,armorTier:id==='D'?3:0,armorLevel:4,hpMax:id==='A'?400:12,hp:id==='A'?400:12,traits:[]},{registry,seed:id,noVariance:true}).unit;
 u.id=id;u.morale=100;u.base.moraleMax=100;prepareCombatModel(u,V4_D20,100);if(id==='C'){applyCombatDamage(u,27,1);u.tags.push('zone:左翼','rank:reserve');}return u;
});
const before=prepareInventoryState({schemaVersion:2,factRevision:1,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:['A','D','C'],inventory:[],protagonistId:'A',commanderId:'A',mode:mass?'mass':'small',autoTurn:false,autoAllyOrders:false,autoSettleXp:true});
const b=mass?new MassBattle({combatants:units,rules:V4_TW,seed:'v4-browser-mass',traitRegistry:registry,commanderId:'A'}):new SmallBattle({combatants:units,rules:V4_D20,battlefield:standardField(),seed:'v4-browser-small',traitRegistry:registry});
b.start();if(b instanceof SmallBattle){b.turnOrder=['A','D','C'];b.turnIndex=0;b.byId('A').pos=14;b.byId('D').pos=7;b.byId('C').pos=28;}
else{b.issue({unitId:'C',type:'hold'});b.issue({unitId:'D',type:'hold'});}
// 固定开局随机位置，使浏览器烟测能观察真实命中及持久伤损，不依赖偶然未命中。
const rng=b.rng as SeededRng;let state=rng.getState();while(mass?rng.next()>.1:rng.d(20)<18)state=rng.getState();rng.setState(state);
const start=captureBattleStart(b,captureBattleArchive(before));
console.log(JSON.stringify({before,active:{...before,battle:{kind:mass?'mass':'small',snap:structuredClone(b.toSnapshot())},activeBattleStart:start}}));
