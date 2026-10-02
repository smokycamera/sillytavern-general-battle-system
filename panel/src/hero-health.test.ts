import { expect, it } from 'vitest';
import { applyXp, generateUnit, traitRegistry, xpProgress } from '../../engine/src/index.js';
import { parseProtocol } from './protocol.js';
import { applyUnitSet } from './unit-set.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
const registry = traitRegistry();
const make = (level = 5, bonuses = {}) => generateUnit({name:'英雄',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',level,bonuses,traits:[]},{seed:'health',registry,noVariance:true}).unit;
function change(save: NarrativeSave, patch: Record<string, unknown>) {
  return applyUnitSet(save, save.storage![0]!.id, patch, 'health-test');
}
const read = (save: NarrativeSave) => materializeUnitRecord(save.storage![0]!,registry);
it('hero spawn keeps narrated life only as a valid wound ratio and never fails on it', () => {
  const cases: [string, {hp:number;hpMax:number} | undefined][] = [
    ['hp="9999" hpMax="9999"',{hp:9999,hpMax:9999}], ['hp="30" hpMax="100"',{hp:30,hpMax:100}], ['hp="1000/1000"',{hp:1000,hpMax:1000}],
    ['hp="999" hpMax="1"',{hp:1,hpMax:1}], ['hp="1"',undefined], ['hp="wrong" hpMax="wrong"',undefined], ['hp="1000/1000" hpMax="1"',undefined], ['maxhp="9999"',undefined],
  ];
  for (const [fields, life] of cases) {
    const result = parseProtocol(`<tb><spawn name="英雄" side="ally" scale="hero" level="L3+5生命" ${fields}/></tb>`);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({level:3,bonuses:{health:5},...life});
    if (!life) for (const key of ['hp','hpMax']) expect(result.events[0]).not.toHaveProperty(key);
  }
  expect(parseProtocol('<tb><spawn name="英雄" side="ally" scale="hero" hp="1"/></tb>').warnings.join('')).toContain('按满生命建档');
  expect(parseProtocol('<tb><spawn name="编队" side="ally" scale="company" hp="40" hpMax="80"/></tb>').events[0]).toMatchObject({hp:40,hpMax:80});
});
it('narrated hero wounds scale current life while the derived maximum stays unchanged', () => {
  const spawn = (fields = '') => {
    const message: MessageEnvelope = { characterId: 'test', chatId: 'wound', branchId: 'main', messageId: '1', swipeId: '0', generationId: 'generation', role: 'assistant', complete: true,
      text: `<tb>\n<spawn name="伤者" side="ally" scale="hero" level="5" ${fields}/>\n</tb>` };
    const save: NarrativeSave = { storage: [], rosterIds: [], factRevision: 1 }, namespace = namespaceOf(message);
    // 固定批次编号使各次建档的种子与推导上限一致，只比较伤势换算。
    const proposal = { ...proposalFromMessage(message, { ...captureGeneration(save, namespace, 'generation'), complete: true })!, id: 'wound' };
    const next = prepareNarrativeTransaction(save, proposal, namespace, true);
    expect(next.rosterIds).toEqual([next.storage![0]!.id]);
    return next.storage![0]!;
  };
  const full = spawn();
  expect(full.hp).toBe(full.base.hpMax);
  for (const [fields, ratio] of [['hp="30" hpMax="100"', .3], ['hp="1/2"', .5], ['hp="9999" hpMax="10"', 1], ['hpMax="1"', 1]] as const) {
    const record = spawn(fields);
    expect(record.base.hpMax).toBe(full.base.hpMax);
    expect(record.hp).toBe(Math.round(full.base.hpMax * ratio));
  }
  expect(spawn('hp="0" hpMax="100"')).toMatchObject({ hp: 1, status: 'ready', base: { hpMax: full.base.hpMax } });
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
