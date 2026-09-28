from pathlib import Path
root=Path.cwd()
def change(file,old,new,count=None):
 p=root/file;s=p.read_text();n=s.count(old)
 if not n or count is not None and n!=count: raise RuntimeError((file,n,old))
 p.write_text(s.replace(old,new))
change('engine/src/types.ts','  overmatch?: boolean;',"  overmatch?: boolean;\n  /** V10: continuous positive grade gaps; absent preserves the V7–V9 safe band. */\n  overmatchCurve?: 'continuous-v1';",1)
change('engine/src/power-anchors.ts',"import type {Armor,Combatant,DamageChannel,Weapon}","import type {Armor,Combatant,DamageChannel,Weapon,RulePack}",1)
change('engine/src/power-anchors.ts',"export function gradeOvermatch(power:number|undefined,defensePower:number,penetration:number,resistance:number):number {",'''export function gradeOvermatch(power:number|undefined,defensePower:number,penetration:number,resistance:number,curve?:RulePack['overmatchCurve']):number {
  if(curve==='continuous-v1'){
    if(power===undefined||!Number.isFinite(power)||power<1||power>10
      ||!Number.isFinite(defensePower)||!Number.isFinite(penetration)||!Number.isFinite(resistance)||power<=defensePower)return 1;
    const gap=power-defensePower,ratio=continuousPowerBudget(power)/continuousPowerBudget(defensePower);
    // No safe band and no x2 discontinuity at a fractional grade boundary.
    const extra=(Math.sqrt(ratio)-1)*(1+gap/(gap+2));
    return 1+extra*Math.max(0,Math.min(1,penetration-resistance));
  }''',1)
change('engine/src/power-anchors.ts','canBlock=true,includeBarrier=false):number {',"canBlock=true,includeBarrier=false,curve?:RulePack['overmatchCurve']):number {",1)
change('engine/src/power-anchors.ts','gradeOvermatch(power,defensePower(unit,channel,includeBarrier),penetration,anchoredProtection(unit,channel));','gradeOvermatch(power,defensePower(unit,channel,includeBarrier),penetration,anchoredProtection(unit,channel),curve);',1)
change('engine/src/power-anchors.ts','gradeOvermatch(power,shieldPower,penetration,resistance);','gradeOvermatch(power,shieldPower,penetration,resistance,curve);',1)
change('engine/src/power-anchors.ts','model=actor.damageModel,overmatch=false):Weapon|undefined {',"model=actor.damageModel,overmatch=false,curve?:RulePack['overmatchCurve']):Weapon|undefined {",1)
change('engine/src/power-anchors.ts',"w.penetration??0,!!w.splashTargets):1)","w.penetration??0,!!w.splashTargets,true,false,curve):1)",1)
for f in ['engine/src/damage.ts','engine/src/skill-attack.ts']:
 for old,new in [('opts.rules?.damageModel,opts.rules?.overmatch)', 'opts.rules?.damageModel,opts.rules?.overmatch,opts.rules?.overmatchCurve)'),('opts.rules.damageModel,opts.rules.overmatch)', 'opts.rules.damageModel,opts.rules.overmatch,opts.rules.overmatchCurve)'),('rules.damageModel,rules.overmatch)', 'rules.damageModel,rules.overmatch,rules.overmatchCurve)'),('rules?.damageModel,rules?.overmatch)', 'rules?.damageModel,rules?.overmatch,rules?.overmatchCurve)')]:
  p=root/f;s=p.read_text();p.write_text(s.replace(old,new))
change('engine/src/damage.ts','overmatchMultiplier(power,target,channel,penetration,area,canBlock)','overmatchMultiplier(power,target,channel,penetration,area,canBlock,false,opts.rules.overmatchCurve)',1)
change('engine/src/damage.ts','canBlock:context.canBlock!==false,multiplier:context.overmatchMultiplier!','canBlock:context.canBlock!==false,multiplier:context.overmatchMultiplier!,...(opts.rules.overmatchCurve?{curve:opts.rules.overmatchCurve}:{})',1)
change('engine/src/recovery.ts','canBlock:boolean; multiplier:number }',"canBlock:boolean; multiplier:number; curve?:import('./types.js').RulePack['overmatchCurve'] }",1)
change('engine/src/recovery.ts','context.area,context.canBlock,true)','context.area,context.canBlock,true,context.curve)',1)
change('engine/src/area-effects.ts','zonePenetration(zone),true):1','zonePenetration(zone),true,true,false,context.rules.overmatchCurve):1',1)
change('engine/src/area-effects.ts','area:true,canBlock:true,multiplier:overmatch}', 'area:true,canBlock:true,multiplier:overmatch,...(context.rules?.overmatchCurve?{curve:context.rules.overmatchCurve}:{})}',1)
marker='/** id → 规则包（战斗快照恢复用；面板只用默认两包） */'
change('engine/src/rules.ts',marker,'''/** Only new battles opt in; snapshots without a curve keep the V7–V9 safe band. */
export const V10_OVERFLOW_D20: RulePack = { ...V9_OVERFLOW_D20, id: 'v10-overflow-d20', name: 'V10 连续跨级毁伤', overmatchCurve: 'continuous-v1' };
export const V10_OVERFLOW_TW: RulePack = { ...V9_OVERFLOW_TW, id: 'v10-overflow-tw', name: 'V10 连续跨级毁伤会战', overmatchCurve: 'continuous-v1' };

'''+marker,1)
change('engine/src/rules.ts','export const RULES_BY_ID: Record<string, RulePack> = {','export const RULES_BY_ID: Record<string, RulePack> = {\n  [V10_OVERFLOW_D20.id]: V10_OVERFLOW_D20, [V10_OVERFLOW_TW.id]: V10_OVERFLOW_TW,',1)
change('panel/src/main.ts','V5_D20, V6_D20, V9_OVERFLOW_D20, V9_OVERFLOW_TW,','V5_D20, V6_D20, V9_OVERFLOW_D20, V10_OVERFLOW_D20, V10_OVERFLOW_TW,',1)
change('panel/src/main.ts',"? V9_OVERFLOW_D20 : LITE_D20", "? V10_OVERFLOW_D20 : LITE_D20",1)
change('panel/src/main.ts',"{ rules: V9_OVERFLOW_TW }", "{ rules: V10_OVERFLOW_TW }",1)
change('engine/src/power-anchors.ts','const extra=(Math.sqrt(ratio)-1)*(1+gap/(gap+2));','const tail=Math.max(0,gap-1)**2;\n    const extra=(Math.sqrt(ratio)-1)*(1+tail/(1+tail));',1)
change('engine/src/power-anchors.ts','/** A one-grade safe band; smooth for fractional channel modifiers, bounded by L1–L10.','/** Legacy keeps its one-grade safe band; V10 starts at any positive fractional gap.',1)
change('engine/src/power-anchors.ts','// No safe band and no x2 discontinuity at a fractional grade boundary.','// Adjacent gaps already use the full budget ratio. Only the ADDITIONAL\n    // far-gap bonus ramps from x1 toward x2 (C1 at gap=1), without a hard cap.',1)
change('engine/src/damage.ts','area,canBlock}:{}) };','area,canBlock,...(opts.rules.overmatchCurve?{curve:opts.rules.overmatchCurve}:{})}:{}) };',1)
import json,hashlib
for file in ['package.json','package-lock.json']:
 p=root/file;data=json.loads(p.read_text());data['version']='1.3.17'
 if file=='package-lock.json':data['packages']['']['version']='1.3.17'
 p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
expected={'engine/src/area-effects.ts': 'e57bf8d7e0fb988ffb85e6894d3a1df40a7ee372a7b9a63feb06d44fbe043153', 'engine/src/damage.ts': '29ce0b8f2072c8f171b9d692ec5c16753cbee5d5fe2fad3d070f6c49f2599545', 'engine/src/power-anchors.ts': '24e54a7a86c62cd51aa7821aff1643fecc5cc51a233492f30ca9b2191568d1bb', 'engine/src/recovery.ts': '69f226f9dd2a328ab3e4b4dddf15d4b9d85a8b8381be7a8e931148a93f5af788', 'engine/src/rules.ts': '664132d50afcb3acea67ba83a38ecdb05753f91310b99aaae0eadaca5ae7d2e8', 'engine/src/skill-attack.ts': 'ca0bd51daee3754dead6f4c863650ebdcdf21aa562ef58b18eac23f50160d0eb', 'engine/src/types.ts': '72529a77310856b2cd89fd796cae9b399004f97c00f783167699d0bbf5eb8333', 'panel/src/main.ts': '5ede2252a9ae9659068126264e362588e22fecc525e467a4a7551325a1f56c22', 'package.json': 'd26ddc862b7f16dc3a8f32a1cd1162ee658ddb231ddc0671425ba013c21a7a77', 'package-lock.json': '402bdea773fcada64a3eba2df1600dd60a5e642f15e79ca1945c00ca4b159769'}
for file,sha in expected.items():
 assert hashlib.sha256((root/file).read_bytes()).hexdigest()==sha,file
