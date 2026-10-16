/** P2：48个配对种子的机械对照，随后独立运行关键地图的完整AI。只写诊断/报告。 */
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { generateUnit, prepareCombatModel,prepareTraitModel,prepareTraitLevelModel,prepareItemModel,prepareSkillModel,
  V17_OVERFLOW_D20,V17_OVERFLOW_TW,SeededRng,resolveAttack,previewAttack,standardConditionMap,traitRegistry,
  memberHealth,applyRecovery,recoveryCapacity,healingYield,regenerationAmount,settleRegeneration,compileSkill,
  parseSkillMechanism,skillMechanismId,prepareCondition,applySkillCondition,beginControlActivation,finishControlActivation,
  controlPolicy,SmallBattle,MassBattle,standardField,upgradeCombatSkills, type Combatant,type RulePack,
} from '../engine/src/index.js';
const defs=standardConditionMap(),reg=traitRegistry(),levels=[1,5,8,10],samples=48;
type Mode='small'|'mass';
function make(id:string,mode:Mode,L:number,traits:string[]=[],armorLevel=3,hero=false):Combatant {
  const rules=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW;
  const u=generateUnit({name:id,side:id.startsWith('a')?'ally':'enemy',scale:mode==='small'||hero?'hero':'company',level:5,hpMax:mode==='mass'&&!hero?30:undefined,
    rulesVersion:'v2',damageModel:'wounds-v2',traits,traitLevels:Object.fromEntries(traits.map(t=>[t,L])),weaponClass:traits.includes('sharpshooter')?'rifle':'sword',weaponLevel:5,armorTier:1,armorLevel}, {seed:id,noVariance:true}).unit;
  u.id=id;prepareCombatModel(u,rules);prepareTraitModel(u,rules);prepareItemModel(u,rules);prepareTraitLevelModel(u,rules);prepareSkillModel(u,rules);
  if(mode==='small')u.pos=id.startsWith('a')?30:23;else u.formationPosition=(u.side==='ally'?'ally':'enemy')+':中军:front';return u;
}
const compile=(u:Combatant,text:string,L:number)=>compileSkill({id:skillMechanismId(parseSkillMechanism(text)!)},L,u.id,'skills-v2');
const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
const stats=(values:number[])=>({mean:mean(values),half95:values.length<2?0:1.96*Math.sqrt(values.reduce((s,v)=>s+(v-mean(values))**2,0)/(values.length-1)/values.length)});
const onlyMode=process.argv.find(a=>a.startsWith('--mode='))?.split('=')[1],skipMechanical=process.argv.includes('--skip-mechanical');
const mechanical:Record<string,unknown>[]=skipMechanical?JSON.parse(readFileSync('.diagnostics/traits-phase2-20261016/calibration-mechanical.json','utf8')):[];
const ai:Record<string,unknown>[]=onlyMode?JSON.parse(readFileSync('.diagnostics/traits-phase2-20261016/calibration-ai.json','utf8')).filter((r:Record<string,unknown>)=>r.mode!==onlyMode):[];
if(!skipMechanical)for(const mode of ['small','mass'] as const)for(const scenario of ['守护防御','实物护甲对照','近战协作','恢复组合'])for(const L of levels) {
  const first:number[]=[],damage:number[]=[],received:number[]=[],restored:number[]=[],permanent:number[]=[],turns:number[]=[],actions:number[]=[],spent:number[]=[],control:number[]=[];
  let preview=0;
  for(let seed=0;seed<samples;seed++) {
    const a=make('a',mode,L,scenario==='近战协作'?['melee-master','berserk']:scenario==='恢复组合'?['regen','medic','guardian']:[]);
    const e=make('e',mode,L,scenario==='守护防御'?['guardian']:[],scenario==='实物护甲对照'?L:3);
    const rules:RulePack=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW,rng=new SeededRng('p2-pair:'+seed);
    const opts=(s:Combatant,t:Combatant)=>({attacker:s,defender:t,rules,conditionDefs:defs,traitRegistry:reg,distance:1,ranged:false});
    if(!seed)preview=previewAttack(opts(a,e)).expectedDamage;
    let outgoing=0,incoming=0,healing=0,n=0,used=0,sp=0;
    const heal=compile(a,'buff治疗',L);const he=heal.effects.find(e=>e.op==='heal')!;
    for(;n<12&&a.hp>0&&e.hp>0;n++) {
      const r=resolveAttack({...opts(a,e),rng});outgoing+=r.hpBefore-r.hpAfter;used++;if(!n)first.push(r.hpBefore-r.hpAfter);
      if(e.hp<=0)break;
      const back=resolveAttack({...opts(e,a),rng});incoming+=back.hpBefore-back.hpAfter;used++;
      if(scenario==='恢复组合'&&a.status==='ready') {
        if(n%3===0&&he.op==='heal'&&recoveryCapacity(a)>0) {healing+=applyRecovery(a,healingYield(a,a,he.amount!,false,he.power));sp+=heal.cost!.amount;used++;}
        healing+=settleRegeneration(a,regenerationAmount(a));
      }
    }
    const probe=make('probe',mode,5);
    const condition=prepareCondition(a,probe,{op:'condition',conditionId:'confused',dur:1,saveDC:8+L},rng).condition;
    applySkillCondition(probe,condition);beginControlActivation(probe,rng,()=>['a']);const activated=Number(controlPolicy(probe)==='confused');finishControlActivation(probe);
    damage.push(outgoing);received.push(incoming);restored.push(healing);turns.push(Math.min(12,n+1));actions.push(used);spent.push(sp);control.push(activated);
    permanent.push([a,e].reduce((s,u)=>s+(u.scale==='hero'?0:Math.max(0,u.base.hpMax-u.hp-(u.recoverableWounded??0))),0));
  }
  mechanical.push({mode,scenario,L,samples,preview,first:stats(first),damage:mean(damage),received:mean(received),healing:mean(restored),permanent:mean(permanent),rounds:mean(turns),actions:mean(actions),SP:mean(spent),controlSuccess:mean(control),lostNormalActivations:mean(control),healingCooldown:2});
}
mkdirSync('.diagnostics/traits-phase2-20261016',{recursive:true});
writeFileSync('.diagnostics/traits-phase2-20261016/calibration-mechanical.json',JSON.stringify(mechanical,null,2)+'\n');
console.log('机械对照完成：'+mechanical.length+'行，每行48配对种子');
for(const mode of (['small','mass'] as const).filter(m=>!onlyMode||m===onlyMode))for(const map of ['开阔独立个体','地形恢复编队'])for(const L of levels)for(let seed=0;seed<2;seed++) {
  const hero=map==='开阔独立个体';
  const units=['a1','a2','e1','e2'].map((id,i)=>make(id,mode,L,i%2?['regen','medic','agile','recon']:['guardian','melee-master','fear','stalk'],3,hero));
  for(const [i,u] of units.entries()) {
    const effects=i%2?['buff治疗','debuff+致盲']:hero?['debuff+魅惑','debuff+混乱']:['debuff+嘲讽','debuff+混乱'];
    u.abilities=effects.map(e=>compile(u,e,L));u.preparedAbilityIds=u.abilities.map(a=>a.id);upgradeCombatSkills(u);
    if(mode==='small')delete u.pos;
  }
  const field=standardField();field.tiles.fill('open');field.objective={...field.objective,kind:'annihilation'};
  if(map==='地形恢复编队') {for(let c=14;c<35;c++)field.tiles[c]=c%2?'forest':'rough';field.environment=['forest'];}
  const rules=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW;
  const b=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules,seed:'p2-ai:'+seed}):new MassBattle({combatants:units,rules,field:{tags:map==='地形恢复编队'?['forest']:[]},formationSlots:3,seed:'p2-ai:'+seed});
  b.start();
  if(b instanceof SmallBattle){units[0]!.pos=37;units[1]!.pos=38;units[2]!.pos=23;units[3]!.pos=24;}
  let steps=0,healing=0,normalActivations=0,constrained=0;const initial=units.map(u=>({id:u.id,hp:memberHealth(u),sp:u.resources.SP??0}));
  while(!b.isOver()&&b.round<=16&&steps<200) {
    const before=new Map(units.map(u=>[u.id,memberHealth(u)]));
    if(b instanceof SmallBattle){const actor=b.active;if(!actor)break;normalActivations++;if(controlPolicy(actor))constrained++;if(actor.status==='ready')b.autoAction(actor.id);else b.endTurn();}
    else {normalActivations+=units.filter(u=>u.status==='ready').length;constrained+=units.filter(u=>u.conditions.some(c=>['confused','charmed','taunted'].includes(c.id))).length;b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
    for(const u of units)healing+=Math.max(0,memberHealth(u)-(before.get(u.id)??0));steps++;
  }
  const results=b.log.flatMap(e=>e.resolutions?.length?e.resolutions:e.resolution?[e.resolution]:[]);
  const damage=results.reduce((s,r)=>s+Math.max(0,r.hpBefore-r.hpAfter),0);
  const entry={mode,map,L,seed,finished:b.isOver(),winner:b.winner(),rounds:b.round,steps,normalActivations,constrainedActivations:constrained,lifeDamage:damage,
    observedNetRecovery:healing,SP:initial.reduce((s,v)=>s+Math.max(0,v.sp-(units.find(u=>u.id===v.id)?.resources.SP??0)),0),
    permanent:units.reduce((s,u)=>s+(u.scale==='hero'?0:Math.max(0,u.base.hpMax-u.hp-(u.recoverableWounded??0))),0),
    abilityActions:b.log.filter(e=>e.kind==='ability').length,final:units.map(u=>({id:u.id,side:u.side,status:u.status,hp:memberHealth(u),cooldowns:u.abilities.map(a=>({id:a.id,cooldown:a.cdLeft??0}))}))};
  ai.push(entry);console.log('AI '+mode+' '+map+' L'+L+' seed'+seed+' '+(entry.finished?'完成':'16轮截尾'));
}
writeFileSync('.diagnostics/traits-phase2-20261016/calibration-ai.json',JSON.stringify(ai,null,2)+'\n');
const n=(v:unknown)=>typeof v==='number'?v.toFixed(2):String(v);
writeFileSync('docs/traits-phase2-calibration-20261017.md',`# 第二阶段首轮校准（2026-10-17）

脚本：\`scripts/calibrate-traits-phase2.ts\`。机械对照使用48个配对种子，训练level5、武器P5、护甲P3；相同seed跨L重复。每行最多12轮交替攻击，只检查机制量级，不代表空间AI胜率。守护/护甲场景的L属于承伤方，其余属于主动方。恢复组合每三轮使用一次主动治疗并在合法周期再生，统计的是显式机械处理预算，未模拟资源不足后的选技。控制成功率为同种子、固定DC(8+L)的一次独立施加探针，不是本行12轮中的控制覆盖率。

完整AI另用两种地图/编成、两种模式、L1/5/8/10各两个种子，共32局；小战运行实际移动、选技、反应和回合AI，会战运行完整军令分配与阶段结算。开阔图使用独立个体，另一图在会战使用编队；16轮仍未结束的对局标明截尾，不当作平局胜率。AI恢复列是每步前后生命净增的保守观测，无法计入同一步内先恢复后受伤的量；机械恢复量为实际恢复接口返回值。SP为初始/最终净消耗，含引擎合法回复；正常激活与受约束激活统计单独保留。原始记录位于\`.diagnostics/traits-phase2-20261016/calibration-*.json\`。

|模式|机械场景|L|首击预览|首击均值±95%半宽|总输出|总承伤|恢复|永久伤亡|轮数|动作|治疗SP|控制成功率|
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${mechanical.map(r=>{const f=r.first as {mean:number;half95:number};return '|'+[r.mode,r.scenario,r.L,n(r.preview),n(f.mean)+' ± '+n(f.half95),n(r.damage),n(r.received),n(r.healing),n(r.permanent),n(r.rounds),n(r.actions),n(r.SP),n(r.controlSuccess)].join('|')+'|';}).join('\n')}

|模式|地图/编成|L|seed|结束|轮数|生命伤害|净恢复|永久伤亡|技能动作|净SP|受约束激活|
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
${ai.map(r=>'|'+[r.mode,r.map,r.L,r.seed,r.finished?'完成':'截尾',r.rounds,n(r.lifeDamage),n(r.observedNetRecovery),n(r.permanent),r.abilityActions,n(r.SP),r.constrainedActivations].join('|')+'|').join('\n')}

上述是有限场景的首轮工程校准。高阶守护/治疗相对level5训练目标的强收益符合规格跨代意图；组合饱和、截尾及AI选择分支需结合原始记录分析，不据这32局推导全局胜率或自动改动候选参数。逐级存在性与同配置升级不退步由另一个612项确定性见证审计完成。
`);
console.log(JSON.stringify({mechanicalRows:mechanical.length,pairedSeeds:samples,aiGames:ai.length,aiFinished:ai.filter(r=>r.finished).length}));
