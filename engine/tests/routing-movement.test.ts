import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type Combatant } from '../src/index.js';
import { movementPoints } from '../src/tactics.js';
import { formationNode } from '../src/mass/formation.js';
const registry=traitRegistry();
const make=(id:string, side:'ally'|'enemy'='ally')=>{
 const u=generateUnit({name:id,side,scale:'company',rulesVersion:'v2',level:3,hpMax:50,speedTier:1,armorTier:0,traits:[]},{seed:id,registry,noVariance:true}).unit;
 u.id=id;u.morale=100;return u;
};
function small(side:'ally'|'enemy'='ally') {
 const a=make('a',side), b=make('b',side==='ally'?'enemy':'ally');
 const field=standardField();field.tiles.fill('open');
 const battle=new SmallBattle({combatants:[a,b],rules:V2_D20,battlefield:field,traitRegistry:registry,seed:'routing'});battle.start();
 a.pos=side==='ally'?10:52;b.pos=side==='ally'?0:62;a.morale=0;
 const settle=()=> (battle as unknown as {settleMorale(u:Combatant):void}).settleMorale(a);
 return {a,b,battle,settle};
}
it('both sides keep retreating after a failed rally; repeated settlement cannot move twice',()=>{
 for(const side of ['ally','enemy'] as const){
  const {a,battle,settle}=small(side), start=a.pos!;settle();const first=a.pos!;
  expect(Math.abs(first-start)).toBe(14);expect(a.status).toBe('routing');
  settle();expect(a.pos).toBe(first);
  battle.round++;settle();expect(Math.abs(a.pos!-first)).toBe(14);expect(a.moraleState!.attempts).toBe(1);
  const restored=SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()),{traitRegistry:registry});const other=restored.combatants.find(u=>u.id==='a')!;
  restored.round++;(restored as unknown as {settleMorale(u:Combatant):void}).settleMorale(other);
  expect(Math.abs(other.pos!-a.pos!)).toBe(14);expect(other.moraleState!.attempts).toBe(2);
 }
});
it('retreat routes around a wall and cannot move when restrained',()=>{
 const {a,battle,settle}=small();battle.battlefield!.tiles[17]='wall';settle();expect(a.pos).not.toBe(10);expect(a.pos).not.toBe(17);
 const before=a.pos;a.conditions=[{id:'restrained',dur:2}];battle.round++;settle();expect(a.pos).toBe(before);
});
it('routing adds one effective speed tier, capped at five, without modifying stored speed',()=>{
 const a=make('a');expect(movementPoints(a)).toBe(1);a.status='routing';expect(movementPoints(a)).toBe(2);expect(a.speedTier).toBe(1);
 a.status='ready';expect(movementPoints(a)).toBe(1);a.speedTier=5;a.status='routing';expect(movementPoints(a)).toBe(5);
});
it('mass battle continues from rear to reserve after a failed rally',()=>{
 const a=make('a'),b=make('b','enemy');const battle=new MassBattle({combatants:[a,b],rules:V2_TW,traitRegistry:registry,seed:'rout-mass'});battle.start();a.morale=0;
 const next=()=>{for(const u of battle.combatants.filter(u=>u.status==='ready'))battle.issue({unitId:u.id,type:'hold'});battle.resolveRound(battle.round);};
 next();expect(a.status).toBe('routing');expect(formationNode(a).rank).toBe('rear');next();expect(formationNode(a).rank).toBe('reserve');expect(a.moraleState!.attempts).toBe(1);
});
