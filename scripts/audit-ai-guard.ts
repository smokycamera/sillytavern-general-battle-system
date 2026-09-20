import { generateUnit, SmallBattle as CurrentSmallBattle, MassBattle as CurrentMassBattle, standardField, traitRegistry, V4_D20, V4_TW, memberHealth, type Combatant, type GenerateInput } from '../engine/src/index.js';
import { bracePose } from '../engine/src/tactics.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const registry = traitRegistry();
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length);
const { SmallBattle, MassBattle } = baseline ? await import(pathToFileURL(resolve(baseline, 'engine/src/index.ts')).href) : { SmallBattle: CurrentSmallBattle, MassBattle: CurrentMassBattle };
const make = (id:string, side:'ally'|'enemy', extra:Partial<GenerateInput> = {}) => { const u = generateUnit({ rulesVersion:'v2', name:id, side, scale:'hero', level:4, hpMax:500, armorTier:0, weaponClass:'sword', weaponLevel:1, traits:[], ...extra }, {registry, seed:id, noVariance:true}).unit; u.id=id; return u; };
const grid = (units:Combatant[], night=false, field=standardField()) => { field.tiles.fill('open'); const b=new SmallBattle({combatants:units,rules:V4_D20,traitRegistry:registry,seed:'ai-audit',battlefield:field,field:{tags:night?['night']:[]}});b.start();b.turnOrder=units.map(u=>u.id);b.turnIndex=0;return b; };
const out:Record<string,unknown>={};
{
 const a=make('a','ally'),e=make('e','enemy'); const b=grid([a,e]); a.pos=30;e.pos=6;
 b.battlefield!.objective={kind:'control',cell:32,rounds:2,limit:60};for(let y=1;y<9;y++)b.battlefield!.tiles[y*7+3]='wall';
 const positions=[]; for(let n=0;n<5&&!b.isOver();n++){b.autoAction('a');positions.push(a.pos);if(!b.isOver())b.endTurn();}
 out.wallDetour={positions,log:b.log.filter(l=>l.kind!=='round'&&l.kind!=='initiative').map(l=>l.text)};
}
{
 const a=make('a','ally',{weaponClass:'rifle'}),e=make('e','enemy',{weaponClass:'rifle'});const b=grid([a,e],true);a.pos=59;e.pos=31;
 const before=b.visibleCombatants('ally').map(u=>u.id);b.autoAction('a');out.newContact={before,after:b.visibleCombatants('ally').map(u=>u.id),pos:a.pos,active:b.active?.id,shots:b.log.filter(l=>l.resolution?.attackerId==='a').length,actions:b.log.filter(l=>l.round===1&&(l.participants?.includes('a')||l.resolution?.attackerId==='a')).map(l=>({kind:l.kind,text:l.text}))};
}
{
 const a=make('a','ally',{weaponClass:'rifle'}),h=make('h-soft','enemy',{hpMax:200}),c=make('z-cohort','enemy',{scale:'company',hpMax:2});
 const b=grid([a,h,c]);a.pos=59;h.pos=31;c.pos=33;c.base={...h.base,hpMax:2};c.formation!.memberHp=100;c.formation!.health=[{hp:100,count:2}];
 h.conditions.push({id:'vulnerable',dur:9}); b.movementSpent.set(a.id,99);
 const options=b.getActionOptions('a').find(o=>o.id==='weapon')?.targets?.map(t=>({id:t.targetId,preview:t.preview,health:memberHealth(b.byId(t.targetId))})); b.autoAction('a');out.healthScoring={options,chosen:b.log.find(l=>l.resolution?.attackerId==='a')?.resolution?.defenderId};
}
{
 const a=make('guard','ally',{shield:true,traits:['shield-wall'],armorTier:3}),r=make('rear','ally',{weaponClass:'bow'}),e=make('shooter','enemy',{weaponClass:'rifle'});const b=grid([a,e,r]);a.pos=31;r.pos=38;e.pos=10;b.brace('guard');b.endTurn();
 out.shieldSmall={rear:b.getActionOptions('shooter').find(o=>o.id==='weapon')?.targets?.find(t=>t.targetId==='rear'),guard:b.getActionOptions('shooter').find(o=>o.id==='weapon')?.targets?.find(t=>t.targetId==='guard')};
}
{
 const a=make('guard','ally',{scale:'company',hpMax:20,shield:true,traits:['shield-wall'],armorTier:3}),r=make('rear','ally',{scale:'company',hpMax:20,weaponClass:'bow'}),e=make('shooter','enemy',{scale:'company',hpMax:20,weaponClass:'rifle'});r.tags.push('rank:rear');
 const b=new MassBattle({combatants:[a,r,e],rules:V4_TW,seed:'mass-shield',traitRegistry:registry});b.start();a.tacticalPose=bracePose(a,undefined,'mass');
 out.shieldMass=b.orderPreview({unitId:e.id,type:'volley',targetId:r.id});
}
{
 const a=make('a','ally',{scale:'company',hpMax:10}),e=make('e','enemy',{scale:'company',hpMax:10});a.tags.push('zone:左翼');e.tags.push('zone:中军');
 const b=new MassBattle({combatants:[a,e],rules:V4_TW,seed:'mass-meeting',traitRegistry:registry});b.start();a.formationPosition='ally:左翼:front';e.formationPosition='enemy:中军:front';
 const turns=[];for(let n=0;n<4&&!b.isOver();n++){b.autoOrders('ally');b.autoOrders('enemy');turns.push([...b.orders.values()]);b.resolveRound();}
 out.massMeeting={turns,attacks:b.log.filter(l=>l.kind==='attack').length};
}
{
 const movers=['a1','a2'].map(id=>make(id,'ally',{body:'vehicle',scale:'company',hpMax:2,weaponClass:'rifle'}));
 const guards=['g1','g2'].map(id=>make(id,'ally',{scale:'company',hpMax:10})),enemy=make('enemy','enemy',{scale:'company',hpMax:10});
 movers.forEach(u=>u.tags.push('zone:左翼','rank:rear'));guards.forEach(u=>u.tags.push('zone:左翼','rank:front'));enemy.tags.push('zone:右翼','rank:rear');
 const b=new MassBattle({combatants:[...movers,...guards,enemy],rules:V4_TW,seed:'reservations',traitRegistry:registry});b.start();guards.forEach(u=>b.issue({unitId:u.id,type:'hold'}));b.issue({unitId:enemy.id,type:'hold'});b.autoOrders('ally');
 const destinations=movers.map(u=>b.orderPreview(b.orders.get(u.id)!).destination?.id);b.resolveRound();out.reservations={destinations,collisions:b.log.filter(l=>l.text.includes('同层冲突')).length};
}
{
 const a=make('a','ally',{body:'vehicle',scale:'company',hpMax:2,weaponClass:'bow',weaponLevel:1,sidearmClass:'cannon',sidearmLevel:6}),e=make('e','enemy',{scale:'company',hpMax:100});a.tags.push('rank:rear');e.tags.push('rank:rear');
 const b=new MassBattle({combatants:[a,e],rules:V4_TW,seed:'choose-weapon',traitRegistry:registry});b.start();const order=b.recommendedOrder(a.id)!;out.weaponChoice={order,weapon:b.orderPreview(order).weaponName};
}
const file='engine/sim/out/ai-guard-'+(baseline?'before':'after')+'.json';writeFileSync(file,JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
