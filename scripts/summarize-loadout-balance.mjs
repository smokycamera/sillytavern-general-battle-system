import {readFileSync,writeFileSync} from 'node:fs';
const root='artifacts/loadout-balance-20261028';
const read=(name)=>JSON.parse(readFileSync(`${root}/${name}.json`,'utf8'));
function csv(name){const lines=readFileSync(`${root}/${name}.csv`,'utf8').trim().split(/\r?\n/);const fields=s=>[...s.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"'));const keys=fields(lines.shift());return lines.map(s=>Object.fromEntries(fields(s).map((v,i)=>[keys[i],v==='true'?true:v==='false'?false:v!==''&&!Number.isNaN(Number(v))?Number(v):v])));}
const catalog=csv('catalog'),cross=csv('cross-level'),marginal=csv('combat-marginals'),profiles=csv('combat-profiles'),anchors=csv('anchors'),defense=csv('defense-marginals');
const numeric=read('numeric-summary'),skills=read('skill-summary');
const select=(r)=>r.level===4&&r.profile==='balanced'&&r.shield==='none'&&r.mode==='d20';
const neg=marginal.filter(r=>r.delta!==''&&r.delta<0);
const exactNeg=neg.filter(r=>r.exact===true);
const stepSummary=['damage','accuracy','penetration'].map(stat=>{const rs=marginal.filter(r=>r.stat===stat&&r.points>=1);return {stat,n:rs.length,zero:rs.filter(r=>r.delta===0).length,negative:rs.filter(r=>r.delta<0).length,exactNegative:rs.filter(r=>r.delta<0&&r.exact===true).length};});
const noTrait=[...new Set(skills.traits.map(r=>r.id))].flatMap(id=>{const rs=skills.traits.filter(r=>r.id===id);return rs.slice(1).filter((r,i)=>r.summary===rs[i].summary).map(r=>({id,from:r.level-1,to:r.level,summary:r.summary}));});
const selected={
  catalogCounts:read('catalog-summary'),stepSummary,exactNeg,negativeExamples:neg.slice(0,12),
  basicL4:catalog.filter(select).filter(r=>['sword','greatsword','dagger','axe','blunt','heavy-rifle','rifle','cannon','sprayer','magic'].includes(r.weapon)),
  daggerSuperHeavy:catalog.filter(r=>r.weapon==='dagger'&&r.tier===4&&r.profile==='balanced'&&r.shield==='none'&&r.mode==='d20'),
  crossExamples:cross.filter(r=>r.weapon==='sword'&&r.tier===2&&r.enchant==='none'&&(r.defenseL===4||r.attackL===4)),
  selectedProfiles:profiles.filter(r=>r.level===4&&r.weapon==='greatsword'&&r.tier===2),
  numericDead:numeric.summary.filter(r=>r.deadPoints>0),noTraitLevel:noTrait,
  skillDead:skills.dead.filter(r=>!r.area),
  correctionExamples:marginal.filter(r=>r.level===4&&r.weapon==='greatsword'&&r.tier===2&&r.points>=0),
  defenseExamples:defense.filter(r=>r.level===4&&r.weapon==='sword'&&r.tier===2&&r.points>=0),
  anchors,
  maximumProfileByL:Array.from({length:10},(_,i)=>{const rs=profiles.filter(r=>r.level===i+1&&r.profile==='maximum'&&r.skill===true);return {level:i+1,count:rs.length,meanOverHp:rs.filter(r=>r.normal>=r.hp).length,expectedOver50Pct:rs.filter(r=>r.expected/r.hp>=.5).length};})
};
writeFileSync(`${root}/findings.json`,JSON.stringify(selected,null,2)+'\n');
console.log(JSON.stringify({stepSummary,exactNegative:exactNeg.length,negativeExamples:neg.slice(0,6),numericDead:selected.numericDead.map(r=>({kind:r.kind,stat:r.stat,dead:r.deadPoints})),traitLevelDead:noTrait,skillDeadCount:skills.dead.length,profileExamples:selected.selectedProfiles.map(r=>({profile:r.profile,enchant:r.enchant,skill:r.skill,expected:r.expected,normal:r.normal,hp:r.hp,hit:r.hit,through:r.through})),anchorExample:anchors.filter(r=>r.axis==='training'&&r.weapon==='sword').map(r=>({L:r.level,hp:r.actorHp,hit:r.hit,expected:r.expected})),maximumProfileByL:selected.maximumProfileByL},null,2));
