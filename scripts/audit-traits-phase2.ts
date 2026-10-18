/** 数据驱动逐级审计：实际执行/预览/可见集合/余量入口，不比较参数表常数。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GRADED_TRAITS, traitRegistry, generateUnit, prepareCombatModel, prepareTraitModel, prepareTraitLevelModel, prepareItemModel,
  V17_OVERFLOW_D20, V17_OVERFLOW_TW, collectMods, resolveStack, standardConditionMap, traitPenetrationBonus, traitLevel,
  lifestealAmount, fatigueAfter, regenerationAmount, settleRegeneration, healingYield, weaponConditions, conditionDamage,
  moraleProfile, bracePose, entrench, movementPoints, formationMarchCost, tileCost, standardField, terrainStalks, canSpot,
  controlBonus, pushPreview, previewAttack, weaponBreachBudget, gridWeapon, penetrationContext, setStrength, FORMATION_NODES, situationalTraitMods, type Combatant, type ObservationContext,
} from '../engine/src/index.js';
const reg = traitRegistry(), defs = standardConditionMap(), field = standardField(); field.tiles.fill('open');
type Mode = 'small' | 'mass';
function make(id: string, L: number, mode: Mode, trait?: string): Combatant {
  const u = generateUnit({ name:id, side:id==='u'?'ally':'enemy', scale:mode==='mass'?'company':'hero', hpMax:mode==='mass'?100:10000,
    rulesVersion:'v2', damageModel:'wounds-v2', level:5, traits:trait?[trait]:[], traitLevels:trait?{[trait]:L}:undefined,
    weaponClass:trait==='ap-weapon'?'heavy-rifle':['sharpshooter','anti-air'].includes(trait??'')?'rifle':'sword', weaponLevel:10, armorTier:0, shield:trait==='shield-wall' }, { seed:id, noVariance:true }).unit;
  u.id=id; const rules=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW;
  prepareCombatModel(u,rules); prepareTraitModel(u,rules); prepareItemModel(u,rules); prepareTraitLevelModel(u,rules);
  u.pos=id==='u'?28:21; u.formationPosition=(id==='u'?'ally':'enemy')+':中军:front'; u.morale=40; return u;
}
function metrics(id: string,L:number,mode:Mode): Record<string,number> {
  const u=make('u',L,mode,id), e=make('e',5,mode), rules=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW;
  const context:ObservationContext={mode,units:[u,e],fieldTags:[],...(mode==='small'?{battlefield:field}:{}),rules,conditions:defs,traitRegistry:reg};
  const out:Record<string,number>={};
  const stack=(key:string,ctx:Parameters<typeof collectMods>[1])=>{
    const input={attacker:u,defender:e,...ctx},mods=collectMods(u,input,defs,id==='sneak-attack'?situationalTraitMods(context,u,e,{ambush:false,flanked:()=>true,magic:ctx.skillDelivery==='magic',ranged:!!ctx.ranged,weapon:u.weapon}):[],reg);
    out[key+':attack']=resolveStack(mods,'atk',input).flatTotal; out[key+':defense']=resolveStack(mods,'def',input).flatTotal;
    out[key+':damage']=resolveStack(mods,'dmg',input).multTotal; out[key+':reduction']=1-resolveStack(mods,'ward',input).multTotal;
    out[key+':initiative']=u.base.spd+resolveStack(mods,'spd',input).flatTotal;
  };
  if(['forest-lore','mountain-born','night-fighter','plains-runner','urban-fighter'].includes(id)) {
    for(const terrain of ['forest','hill','street','open']) for(const ranged of [false,true]) for(const charge of [false,true]) stack(`${terrain}:${ranged}:${charge}`,{terrain,opponentTerrain:'open',fieldTags:[terrain==='street'?'urban':terrain==='open'?'plains':terrain],ranged,charge,distance:1,attackerHigher:terrain==='hill'});
    if(id==='forest-lore'||id==='mountain-born') { const terrain=id==='forest-lore'?'forest':'hill',tags=[id==='forest-lore'?'forest':'mountain']; field.tiles[1]=terrain; out['terrain movement cost']=-(mode==='small'?tileCost(field,1,u):formationMarchCost(u,tags)); field.tiles[1]='open'; out['legal terrain concealment']=Number(terrainStalks(u,terrain)); }
    if(id==='night-fighter') { context.fieldTags=['night']; for(let d=1;d<=8;d++){ u.pos=0;e.pos=field.width*d; if(mode==='mass'){u.formationPosition=d<3?'ally:左翼:front':'ally:左翼:reserve'; const origin=d<3?3:5;e.formationPosition=FORMATION_NODES.find(n=>n.side==='enemy'&&n.x+origin-n.y===d)?.id??'enemy:右翼:reserve';} out['night visible:'+d]=Number(canSpot(context,u,e)); } stack('night',{fieldTags:['night']}); out['night mobility']=movementPoints(u,['night']); }
    if(id==='plains-runner')out['plains mobility']=movementPoints(u,['plains']);
    if(id==='urban-fighter')stack('urban long shot',{terrain:'street',fieldTags:['urban'],ranged:true,distance:5});
    if(id==='urban-fighter')out['urban concealment']=Number(terrainStalks(u,'street'));
  } else if(id==='lifesteal') { setStrength(u,1); u.recoverableWounded=50; out['actual life loss converted']=lifestealAmount(u,e,1000); }
  else if(id==='fatigue-trained') out['actual fatigue ledger']=-fatigueAfter(u,1);
  else if(id==='regen') { setStrength(u,1); u.recoverableWounded=50; if(u.formation)u.formation.health=[{hp:1,count:1}]; let total=0;for(let n=0;n<3;n++) total+=settleRegeneration(u,regenerationAmount(u));out['three legal periods including saved remainder']=total+(u.regenerationRemainder??0)/10000; }
  else if(id==='medic') { const t=make('e',5,'small');t.hp=1;out['actual healing budget']=healingYield(u,t,1000,false,5); }
  else if(id==='poison-strike') { const c=weaponConditions(u,e,u.weapon,1,reg)[0]!;out['frozen DOT expectation at roll4']=conditionDamage(e,4,c); }
  else if(id==='fear'||id==='commander'||id==='stubborn') { if(id==='commander')e.side='ally'; const p=moraleProfile(context,id==='stubborn'?u:e,reg);out['effective morale']=id==='fear'?-p.effective:p.effective;out['fear pressure']=id==='fear'?p.fear:0;out['command']=p.command;out['resilience']=p.resilience; }
  else if(id==='ap-weapon')out['real kinetic penetration']=penetrationContext({attacker:u,defender:e,ranged:true,rules}).penetration;
  else if(id==='tenacity') { out['control save bonus']=controlBonus(u,'stunned');for(let force=1;force<=4;force++)out['blocks legal push force'+force]=Number(!!pushPreview(context,e,u,{op:'push',force,steps:1}).reason?.includes('坚韧')); }
  else if(id==='agile') { field.tiles[1]='rough';out['terrain cost']=-(mode==='small'?tileCost(field,1,u):formationMarchCost(u,['forest']));field.tiles[1]='open';out['mobility']=movementPoints(u);stack('initiative',{}); }
  else if(id==='siege-breaker')out['actual structure damage']=weaponBreachBudget(u,u.weapon).damage;
  else if(id==='stalk'||id==='recon') {
    for(let opponent=0;opponent<=10;opponent++)for(let d=1;d<=(mode==='small'?7:3);d++) {
      const observer=id==='recon'?u:e,subject=id==='stalk'?u:e;
      if(id==='recon'){subject.traits=['stalk'];subject.traitLevels={stalk:Math.max(1,opponent)};}
      else {observer.traits=opponent?['recon']:[];observer.traitLevels=opponent?{recon:opponent}:{};}
      observer.pos=0;subject.pos=d*field.width;observer.formationPosition='ally:中军:front';subject.formationPosition=d===1?'enemy:中军:front':d===2?'enemy:左翼:front':'enemy:左翼:rear';
      const visible=canSpot(context,observer,subject);out[`opponent L${opponent}, distance${d}`]=Number(id==='recon'?visible:!visible);
    }
  } else if(id==='sharpshooter') {
    const w=mode==='small'?gridWeapon(u.weapon,true,u.armsModel):u.weapon;
    for(const moved of [false,true])for(const distance of [1,w!.range!])for(const cover of [0,2]) {
      const p=previewAttack({attacker:u,defender:e,rules,conditionDefs:defs,traitRegistry:reg,weaponOverride:w,ranged:true,moved,distance,
        extraMods:moved?[{source:'stance',name:'移动射击',category:'movement',kind:'atk',type:'flat',value:-2}]:[],defenderMods:cover?[{source:'stance',name:'明确掩护',category:'cover',kind:'def',type:'flat',value:cover}]:[]});
      out[`shot:${moved}:${distance}:${cover}:attack`]=p.attackScore!;out[`shot:${moved}:${distance}:${cover}:target defense`]=-p.defenseScore!;
    }
  } else {
    if(id==='trample')u.body='large'; if(id==='anti-large')e.body='large'; if(id==='anti-air')e.airborne=true;
    if(id==='pike-wall')e.mount=true;
    if(['pike-wall','shield-wall'].includes(id))u.tacticalPose=bracePose(u,e,mode,mode==='small'?field.width:undefined);
    if(id==='fortification')entrench(u,mode);
    for(const ranged of [false,true])for(const charge of [false,true])for(const moved of [false,true])for(const straight of [false,true])for(const magic of [false,true]) stack(`${ranged}:${charge}:${moved}:${straight}:${magic}`,{ranged,charge,moved,chargeStraight:straight,maxRange:10,distance:2,skillDelivery:magic?'magic':ranged?'ranged':'melee',area:true,engaged:false});
  }
  return out;
}
if(process.argv.includes('--debug')) { console.log({width:field.width,height:field.height});for(const mode of ['small','mass'] as const)for(const L of [2,3,5,6,7,8])console.log(mode,L,metrics('night-fighter',L,mode));process.exit(0); }
const entryFor=(id:string,field:string)=>['stalk','recon','night-fighter'].includes(id)&&field.includes('distance')?'canSpot':field.includes('movement cost')||field==='terrain cost'?'tileCost / formationMarchCost':id==='regen'?'settleRegeneration(regenerationAmount)':id==='medic'?'healingYield':id==='poison-strike'?'weaponConditions → conditionDamage':['fear','commander','stubborn'].includes(id)?'moraleProfile':id==='ap-weapon'?'penetrationContext':id==='tenacity'?'controlBonus / pushPreview':id==='siege-breaker'?'weaponBreachBudget':id==='lifesteal'?'lifestealAmount':id==='stamina'?'fatigueAfter':id==='sharpshooter'?'previewAttack':'collectMods → resolveStack';
const rows:Record<string,unknown>[]=[],failures:string[]=[];
for(const mode of ['small','mass'] as const)for(const id of GRADED_TRAITS) {
  const ladder=Array.from({length:10},(_,i)=>metrics(id,i+1,mode));
  for(const [i,m] of ladder.entries()) for(const [key,value] of Object.entries(m)) if(!Number.isFinite(value))failures.push(`${mode}:${id}:L${i+1}:${key}非有限数`);
  for(let L=1;L<10;L++){
    const before=ladder[L-1]!,after=ladder[L]!,fields=Object.keys(before).filter(key=>Math.abs(after[key]!-before[key]!)>1e-8);
    const regressed=Object.keys(before).filter(key=>after[key]!<before[key]!-1e-8);
    if(!fields.length)failures.push(`${mode}:${id}:L${L}→${L+1}无真实差异`);
    if(regressed.length)failures.push(`${mode}:${id}:L${L}→${L+1}退步:${regressed.join(',')}`);
    rows.push({trait:id,name:reg.get(id)!.name,mode,from:L,to:L+1,field:fields[0],before:before[fields[0]!],after:after[fields[0]!],premise:fields[0],
      input:{training:5,weaponLevel:10,armorTier:0,scale:mode==='small'?'hero':'company',traitLevels:[L,L+1],scenario:fields[0]},entry:entryFor(id,fields[0]??''),beforeMetrics:before,afterMetrics:after,regressed});
  }
}
mkdirSync('.diagnostics/traits-phase2-20261016',{recursive:true});
writeFileSync('.diagnostics/traits-phase2-20261016/level-witness-matrix.json',JSON.stringify({rows,failures},null,2)+'\n');
writeFileSync('docs/traits-phase2-level-witnesses-20261016.md','# 第二阶段逐级差异矩阵\n\n由 `npx vite-node scripts/audit-traits-phase2.ts` 从实际引擎入口生成。每种战斗模式独立检查9次相邻升级；数值为执行预算、合法成本、可见集合或已保存余量的确定性观测值。固定训练level5、武器规格L10、无甲；小战个体/会战编队。具体场景字段含地形、远近战、冲锋、移动/掩护或对手L与距离；完整输入及两级全部候选结果保存在 `.diagnostics/traits-phase2-20261016/level-witness-matrix.json`。脚本检查所有观测值有限且升级不退步；本表列出每次升级的首个见证。\n\n|特质|模式|相邻升级|见证字段/前提|前|后|实际入口|\n|---|---|---|---|---:|---:|---|\n'+(rows as {name:string;mode:string;from:number;to:number;field?:string;before?:number;after?:number;entry?:string}[]).map(r=>`|${r.name}|${r.mode}|L${r.from}→L${r.to}|${r.field??'缺失'}|${r.before??''}|${r.after??''}|${r.entry}|`).join('\n')+'\n\n审计失败：'+(failures.length?failures.join('；'):'无')+'。\n');
console.log(JSON.stringify({traits:GRADED_TRAITS.length,adjacentPairs:rows.length,failures},null,2));
if(failures.length)throw Error('逐级差异验收失败；未满足项不能宣称完成');
