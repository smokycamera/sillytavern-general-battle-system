import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { narrativeProjection } from '../panel/src/narrative-controller.js';
// 默认只测当前源；对比时传 --baseline=恢复点目录，不绑定某台电脑。
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length);
function readBook(root: string) {
  const paths = ['!通用战斗系统约束.json','通用战斗系统约束.json'].map(name => resolve(root,'assets/worldbook',name));
  const path = paths.find(existsSync); if (!path) throw Error(`找不到世界书：${root}`);
  return JSON.parse(readFileSync(path,'utf8'));
}
const currentBook=readBook('.'), beforeBook=baseline?readBook(baseline):undefined;
const old=baseline?await import(pathToFileURL(resolve(baseline,'panel/src/narrative-controller.ts')).href):undefined;
const registry=traitRegistry();
const storage=['ally','enemy'].map(side=>{
  const unit=generateUnit({rulesVersion:'v2',name:side==='ally'?'守备连':'突击队',side:side as 'ally'|'enemy',scale:'company',hpMax:80,level:3,weaponClass:'rifle',traits:[]},{registry,seed:side,noVariance:true}).unit;
  unit.id=side;return unitRecordFromCombatant(unit);
});
const save={storage,rosterIds:storage.map(r=>r.id),schemaVersion:2,factRevision:1};
const text=(book: typeof currentBook,constantOnly=false)=>Object.values(book.entries as Record<string,{content:string;constant:boolean}>).filter(e=>!constantOnly||e.constant).map(e=>e.content).join('\n');
const sample=(book:typeof currentBook,project:typeof narrativeProjection)=>({worldbookAlways:text(book,true),worldbookAll:text(book),twoUnitProjection:project(save),commonTwoUnitTotal:text(book,true)+'\n'+project(save)});
const after=sample(currentBook,narrativeProjection),before=old?sample(beforeBook,old.narrativeProjection):undefined;
mkdirSync('engine/sim/out',{recursive:true});
writeFileSync('engine/sim/out/narrative-prompt-samples.json',JSON.stringify({...(before?{before}:{}),after},null,2));
console.log(JSON.stringify({unit:'字符（不是token）',baseline:baseline??'未指定，仅测当前',current:Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value.length]))},null,2));
