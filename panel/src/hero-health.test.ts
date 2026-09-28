import { expect, it } from 'vitest';
import { applyXp, generateUnit, traitRegistry, xpProgress } from '../../engine/src/index.js';
import { parseProtocol } from './protocol.js';
import { applyUnitSet } from './unit-set.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import type { NarrativeSave } from './narrative-state.js';
const registry = traitRegistry();
const make = (level = 5, bonuses = {}) => generateUnit({name:'英雄',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',level,bonuses,traits:[]},{seed:'health',registry,noVariance:true}).unit;
function change(save: NarrativeSave, patch: Record<string, unknown>) {
  return applyUnitSet(save, save.storage![0]!.id, patch, 'health-test');
}
const read = (save: NarrativeSave) => materializeUnitRecord(save.storage![0]!,registry);
it('hero spawn discards life fields and aliases while preserving level health modifiers', () => {
  for (const fields of ['hp="9999" hpMax="9999"','hp="1"','hp="1000/1000"','hp="999" hpMax="1"','hp="wrong" hpMax="wrong"','hp="1000/1000" hpMax="1"','maxhp="9999"']) {
    const result = parseProtocol(`<tb><spawn name="英雄" side="ally" scale="hero" level="L3+5生命" ${fields}/></tb>`);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({level:3,bonuses:{health:5}});
    expect(result.events[0]).not.toHaveProperty('hp');
    expect(result.events[0]).not.toHaveProperty('hpMax');
  }
  expect(parseProtocol('<tb><spawn name="编队" side="ally" scale="company" hp="40" hpMax="80"/></tb>').events[0]).toMatchObject({hp:40,hpMax:80});
});
it('story life survives save/reload and level/health changes until the standard exceeds it', () => {
  let save: NarrativeSave = {storage:[unitRecordFromCombatant(make())],rosterIds:[]};
  save=change(save,{hp:1000,hpMax:1000});
  save=JSON.parse(JSON.stringify(save));
  save=change(save,{level:7});
  expect(read(save)).toMatchObject({hp:1000,base:{hpMax:1000}});
  save=change(save,{level:5,bonuses:{health:8}});
  expect(read(save)).toMatchObject({hp:1000,base:{hpMax:1000}});
  save=change(save,{hp:100,hpMax:100});
  save=change(save,{level:5,bonuses:{health:8}});
  expect(read(save)).toMatchObject({hp:100,base:{hpMax:make(5,{health:8}).base.hpMax}});
  save=change(save,{hp:100,hpMax:100});
  save=change(save,{level:7,bonuses:{health:0}});
  expect(read(save)).toMatchObject({hp:100,base:{hpMax:make(7).base.hpMax}});
});
it('XP upgrades use the same floor, preserve wounds, and do not revive zero HP', () => {
  for (const max of [100,1000]) for (const hp of [0,50]) {
    const unit=make(); unit.hp=hp; unit.base.hpMax=max;
    applyXp(unit,xpProgress(unit)!.next,registry);
    expect(unit.level).toBe(6);
    expect(unit.base.hpMax).toBe(Math.max(max,make(6).base.hpMax));
    expect(unit.hp).toBe(hp);
  }
});
