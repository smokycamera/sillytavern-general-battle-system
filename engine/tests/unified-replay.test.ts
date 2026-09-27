import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SmallBattle, MassBattle, traitRegistry, memberHealth } from '../src/index.js';
import fixtures from './fixtures/unified-balance-replays.json';
// Recorded by the old engine and the independently tested prototype before this implementation.
// Only the prototype rule/skill/body-version markers are adapted; numeric snapshots and outcomes are fixed.
describe('V5 saved battles and V6 prototype replay compatibility',()=>{
 for(const f of fixtures)it(`${f.version} ${f.scenario} T${f.level}`,()=>{
  const b=f.mode==='small'?SmallBattle.fromSnapshot(structuredClone(f.initial),{traitRegistry:traitRegistry()}):MassBattle.fromSnapshot(structuredClone(f.initial),{traitRegistry:traitRegistry()});
  let steps=0,last=0;
  while(!b.isOver()){
   if(++steps>1000)throw Error('Unexpected non-termination');last=b.round;
   if(b instanceof SmallBattle){if(b.active!.status==='ready')b.autoAction(b.active!.id);else b.endTurn();}
   else {b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
  }
  expect(last).toBe(f.rounds);expect(steps).toBe(f.steps);expect(b.winner()).toBe(f.winner);
  expect(b.combatants.map(u=>[u.id,u.hp,memberHealth(u),u.status])).toEqual(f.final);
  expect(createHash('sha256').update(JSON.stringify(b.log.map(e=>[e.round,e.kind,e.text]))).digest('hex')).toBe(f.logSha256);
 },20000);
});
