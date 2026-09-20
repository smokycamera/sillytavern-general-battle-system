import { describe, it, expect } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, traitRegistry } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { narrativeProjection, narrativeProjectionDetails } from './narrative-controller.js';
import { beginNarrativeDelivery, finishNarrativeDelivery, makeNarrativeBatch, narrativeEvents, battleIdOf, battleEpilogue, completedBattleRounds, type BattleDeliveries, type BattleReport } from './battle-reports.js';
import { lastBattleAction } from './battle-presentation.js';
const reg=traitRegistry();
function unit(id:string, side:'ally'|'enemy'='ally') {
  const u=generateUnit({rulesVersion:'v2',name:id,side,scale:'hero',level:4,weaponClass:'rifle',traits:[]},{seed:id,registry:reg,noVariance:true}).unit;u.id=id;return u;
}
function fixture(){const b=new SmallBattle({combatants:[unit('甲'),unit('乙','enemy')],battlefield:standardField(),rules:V2_D20,seed:'upgrade',traitRegistry:reg});b.start();return b;}
describe('发送与自动策略的关键边界',()=>{
  it('上一行动合并实际速射各段，和目标总损失一致',()=>{
    const b=fixture();b.turnOrder=['甲','乙'];b.turnIndex=0;b.byId('甲').pos=42;b.byId('乙').pos=21;
    const before=b.byId('乙').hp;b.attack('甲','乙');
    expect(lastBattleAction(b)?.entry.resolution?.finalDamage).toBe(before-b.byId('乙').hp);
  });
  it('增量只收录公开事件，区间覆盖原始日志序号，失败不跳过',()=>{
    const b=fixture();b.log=[{round:1,kind:'condition',text:'甲恢复3生命',observedBy:['ally']},{round:1,kind:'condition',text:'隐藏的敌方调兵',observedBy:['enemy']}];
    const deliveries:BattleDeliveries={},batch=makeNarrativeBatch(b,undefined,deliveries,'delta');
    expect(batch.to).toBe(2);expect(batch.text).toContain('甲恢复3生命');expect(batch.text).not.toContain('隐藏的敌方调兵');
    beginNarrativeDelivery(deliveries,batch);finishNarrativeDelivery(deliveries,batch,{status:'failed'});
    expect(deliveries[batch.battleId]!.cursor).toBe(0);
    beginNarrativeDelivery(deliveries,batch);finishNarrativeDelivery(deliveries,batch,{status:'sent'});
    expect(deliveries[batch.battleId]!.cursor).toBe(2);expect(()=>makeNarrativeBatch(b,undefined,deliveries,'delta')).toThrow('没有新的');
  });
  it('未知/插入结果阻止下一批，复制不推进；人工核对后可继续',()=>{
    const b=fixture();b.log=[{round:1,kind:'condition',text:'甲恢复3生命',observedBy:['ally']}];
    const deliveries:BattleDeliveries={},batch=makeNarrativeBatch(b,undefined,deliveries,'delta');
    beginNarrativeDelivery(deliveries,batch);finishNarrativeDelivery(deliveries,batch,{status:'unknown'});
    expect(()=>beginNarrativeDelivery(deliveries,{...batch,key:'delta:0:2',to:2})).toThrow('待核对');
    finishNarrativeDelivery(deliveries,batch,{status:'failed'});beginNarrativeDelivery(deliveries,batch);finishNarrativeDelivery(deliveries,batch,{status:'copied'});
    expect(deliveries[batch.battleId]!.cursor).toBe(0);finishNarrativeDelivery(deliveries,batch,{status:'sent'});expect(deliveries[batch.battleId]!.cursor).toBe(1);
  });
  it('收兵后的报告仍保留未发送区间，反序列化不丢游标',()=>{
    const b=fixture();b.log=[{round:1,kind:'condition',text:'第一次恢复',observedBy:['ally']},{round:2,kind:'condition',text:'第二次恢复',observedBy:['ally']}];
    const id=battleIdOf(b),report:BattleReport={id,card:'',digest:'',summary:'当前状态',deliveries:{},narrativeEvents:narrativeEvents(b),eventCount:b.log.length};
    const deliveries=JSON.parse(JSON.stringify({[id]:{cursor:1,receipts:{}}}));
    const batch=makeNarrativeBatch(undefined,report,deliveries,'delta');expect(batch.text).not.toContain('第一次恢复');expect(batch.text).toContain('第二次恢复');
  });
  it('场景范围保留固定关注和显式排除，统计反映关闭的单位段',()=>{
    const storage=['甲','乙','丙','丁'].map(id=>unitRecordFromCombatant(unit(id)));
    const save={storage,rosterIds:['甲'],promptSettings:{unitScope:'scene' as const,pinnedUnitIds:['乙'],excludedUnitIds:['丙']}};
    const result=narrativeProjection(save,'丙与丁');expect(result).toContain('"name":"甲"');expect(result).toContain('"name":"乙"');expect(result).toContain('"name":"丁"');expect(result).not.toContain('"name":"丙"');
    expect(narrativeProjectionDetails({...save,promptSettings:{...save.promptSettings,sections:{units:{enabled:false}}}}).units).toHaveLength(0);
  });
  it('固守小战不主动移位，策略随快照恢复；默认敌方策略不改',()=>{
    const b=fixture();b.turnOrder=['甲','乙'];b.turnIndex=0;b.allyTactic='defensive';const pos=b.byId('甲').pos;b.autoAction('甲');expect(b.byId('甲').pos).toBe(pos);
    const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()),{traitRegistry:reg});expect(restored.allyTactic).toBe('defensive');
  });
  it('会战固守建议不机动，查询不消耗随机源并可恢复策略',()=>{
    const combatants=[unit('甲'),unit('乙','enemy')].map(u=>({...u,scale:'company' as const}));
    const b=new MassBattle({combatants,rules:V2_TW,seed:'upgrade-mass',traitRegistry:reg});b.start();b.allyTactic='defensive';
    const before=b.toSnapshot().rngState,order=b.recommendedOrder('甲');expect(['rank-forward','rank-back','shift-left','shift-right','charge']).not.toContain(order?.type);expect(b.toSnapshot().rngState).toBe(before);
    expect(MassBattle.fromSnapshot(structuredClone(b.toSnapshot()),{traitRegistry:reg}).allyTactic).toBe('defensive');
    expect(battleEpilogue(b)).toContain('尚未结束');
    b.autoOrders('ally');b.resolveRound();expect(completedBattleRounds(b)).toBe(1);
  });
});
