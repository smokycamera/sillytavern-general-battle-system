#!/usr/bin/env python3
"""Validate actual-battle rows and aggregate scenario/policy statistics (stdlib only)."""
from pathlib import Path
import collections
import gzip
import hashlib
import json
import random
import statistics

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'engine/sim/out/worldview-2000'
POLICY = ROOT / 'engine/sim/out/skill-policy-480'
ARMOR = ROOT / 'engine/sim/out/armor-control-320'
OUT = ROOT / 'docs/worldview-audit-20260926'
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((MAIN / 'manifest.json').read_text())
cells = {c['id']: c for c in manifest['cells']}
rows = sorted([json.loads(line) for p in MAIN.glob('worker-*.jsonl') for line in p.read_text().splitlines()], key=lambda r: r['id'])
policy = sorted([json.loads(line) for p in POLICY.glob('worker-*.jsonl') for line in p.read_text().splitlines()], key=lambda r: r['id'])
armor = [json.loads(line) for line in (ARMOR/'matches.jsonl').read_text().splitlines()]
assert len(rows) == len({r['id'] for r in rows}) == 2000, len(rows)
assert len(policy) == len({r['id'] for r in policy}) == 480, len(policy)
assert len(armor) == len({r['id'] for r in armor}) == 320, len(armor)
assert len({r['scriptSha256'] for r in rows}) == 1
assert all(r['sourceSha256'] == manifest['sourceSha256'] for r in rows + policy + armor)
assert all(r['result'] in ['A', 'B', 'draw'] for r in rows + policy + armor)
assert collections.Counter(r['cellId'] for r in rows) == {c: 10 for c in cells}
expected = {(c, seed, swap) for c in cells for seed in range(5) for swap in [False, True]}
assert {(r['cellId'], r['seed'], r['swap']) for r in rows} == expected
assert {(r['cellId'], r['seed'], r['swap'], r['policy']) for r in policy} == {
    (f'c{cell}', seed, swap, strategy) for cell in range(180,192) for seed in range(10)
    for swap in [False,True] for strategy in ['auto','skill-priority']}
assert {(r['caseId'],r['mode'],r['seed'],r['swap']) for r in armor} == {
    (case,mode,seed,swap) for case in ['sword-blunt-unarmored','sword-blunt-heavy','rifle-energy-kinetic','rifle-energy-thermal']
    for mode in ['small','mass'] for seed in range(20) for swap in [False,True]}
assert all(r['initial'] and len({u['id'] for u in r['initial']}) == len(r['initial']) for r in rows)
assert all(u['health'] >= 0 and u['hp'] >= 0 for r in rows for u in r['final'])
log_validation = {}
for directory, records in [(MAIN, rows), (POLICY, policy), (ARMOR, armor)]:
    found = set()
    for p in directory.glob('logs*.jsonl.gz'):
        with gzip.open(p, 'rt') as f:
            for line in f:
                record = json.loads(line)
                assert record['id'] not in found
                found.add(record['id'])
                assert record['initialSnapshot']['combatants'] and record['log']
    assert found == {r['id'] for r in records}
    log_validation[directory.name] = len(found)

def grouped(data, key):
    d = collections.defaultdict(list)
    for r in data:
        d[key(r)].append(r)
    return d

def stat(data):
    n = len(data)
    return dict(n=n, aWins=sum(r['result']=='A' for r in data), bWins=sum(r['result']=='B' for r in data),
                draws=sum(r['result']=='draw' for r in data), limit=sum(r['reachedLimit'] for r in data),
                meanRounds=round(statistics.mean(r['roundsObserved'] for r in data), 2),
                medianRounds=statistics.median(r['roundsObserved'] for r in data),
                p90Rounds=sorted(r['roundsObserved'] for r in data)[min(n-1, int(n*.9))],
                abilityUses=sum(u['used'] for r in data for u in r['usage']),
                battlesWithAbilityUse=sum(any(u['used'] for u in r['usage']) for r in data))

def paired_interval(data, value, repetitions=1500):
    """Resample seed-pairs within each fixed design cell; report descriptive 95% CI."""
    pairs = grouped(data, lambda r: (r['cellId'], r['seed']))
    strata = collections.defaultdict(list)
    for (cell, seed), pair in pairs.items():
        assert len(pair) == 2
        strata[cell].append(statistics.mean(value(r) for r in pair))
    rng = random.Random(20260926)
    estimates = []
    for _ in range(repetitions):
        sample = [rng.choice(v) for v in strata.values() for _ in v]
        estimates.append(sum(sample)/len(sample))
    estimates.sort()
    return [round(100 * estimates[int(repetitions*p)], 2) for p in [.025, .975]]

groups = [{'family': family, 'mode': mode, **stat(v)} for (family, mode), v in grouped(rows, lambda r:(r['family'],r['mode'])).items()]
by_cell = [{**{k:x for k,x in cells[key].items() if k not in ['a','b']}, **stat(v), 'aWinRateCI95': paired_interval(v, lambda r: r['result']=='A')}
           for key, v in grouped(rows, lambda r:r['cellId']).items()]
by_scene = [{'scene':s,'mode':m,**stat(v)} for (s,m),v in grouped(rows,lambda r:(r['scene'],r['mode'])).items()]
cross_world = []
for family in ['cross-equal','cross-native']:
    for mode in ['small','mass']:
        for world in manifest['worlds']:
            v = [r for r in rows if r['family']==family and r['mode']==mode and world['id'] in [cells[r['cellId']]['worldA'],cells[r['cellId']]['worldB']]]
            win = lambda r: r['result']==('A' if cells[r['cellId']]['worldA']==world['id'] else 'B')
            score = lambda r: .5 if r['result']=='draw' else int(win(r))
            cross_world.append({'family':family,'mode':mode,'world':world['id'],'name':world['name'], 'n':len(v),
                                'wins':sum(win(r) for r in v),'draws':sum(r['result']=='draw' for r in v),
                                'scorePct':round(statistics.mean(score(r) for r in v)*100,2), 'scoreCI95':paired_interval(v,score)})
native = [r for r in rows if r['family']=='cross-native']
high_tech = lambda r: r['result']==('A' if cells[r['cellId']]['powerA']>cells[r['cellId']]['powerB'] else 'B')
native_summary = [{'mode':mode, 'n':len(v), 'higherPowerWins':sum(high_tech(r) for r in v),'draws':sum(r['result']=='draw' for r in v),
                   'higherPowerWinCI95':paired_interval(v,high_tech)} for mode,v in grouped(native,lambda r:r['mode']).items()]
usage = []
for (mode, definition, source), v in grouped([{'mode':r['mode'],**u} for r in rows for u in r['usage']], lambda u:(u['mode'],u['definition'],u['source'])).items():
    usage.append(dict(mode=mode,definition=definition,source=source,equippedUnitBattles=len(v),usedUnitBattles=sum(u['used']>0 for u in v),totalUses=sum(u['used'] for u in v)))
pair_data=grouped(rows,lambda r:(r['cellId'],r['seed']))
pair_summary={}
for mode in ['small','mass']:
    pairs=[v for v in pair_data.values() if v[0]['mode']==mode]
    pair_summary[mode]={'pairs':len(pairs),'sameOutcome':sum(p[0]['result']==p[1]['result'] for p in pairs),'differentOutcome':sum(p[0]['result']!=p[1]['result'] for p in pairs),
                        'allyWins':sum(r['winner']=='ally' for p in pairs for r in p),'enemyWins':sum(r['winner']=='enemy' for p in pairs for r in p)}
policy_summary=[{'cellId':c,'name':cells[c]['name'],'mode':cells[c]['mode'],'policy':p,**stat(v),'aWinRateCI95':paired_interval(v,lambda r:r['result']=='A')}
                for (c,p),v in grouped(policy,lambda r:(r['cellId'],r['policy'])).items()]
policy_usage=[{'mode':m,'policy':p,'definition':d,'equippedUnitBattles':len(v),'usedUnitBattles':sum(u['used']>0 for u in v),'totalUses':sum(u['used'] for u in v)}
               for (m,p,d),v in grouped([{'mode':r['mode'],'policy':r['policy'],**u} for r in policy for u in r['usage']],lambda u:(u['mode'],u['policy'],u['definition'])).items()]
armor_summary=[{'caseId':c,'mode':m,**stat(v),'aWinRateCI95':paired_interval(v,lambda r:r['result']=='A')}
               for (c,m),v in grouped(armor,lambda r:(r['caseId'],r['mode'])).items()]
coverage={'trainingLevels':sorted({u['level'] for r in rows for u in r['initial']}), 'equipmentLevels':sorted({u['power'] for r in rows for u in r['initial']}),
          'weapons':sorted({u['weapon'] for r in rows for u in r['initial']}), 'bodies':sorted({u['body'] for r in rows for u in r['initial']}),
          'companySizes':sorted({u['hp'] for r in rows if r['mode']=='mass' for u in r['initial']}),
          'skillDefinitions':len({u['definition'] for u in usage if u['source']=='skill'}),
          'skillDefinitionsUsed':len({u['definition'] for u in usage if u['source']=='skill' and u['totalUses']>0}),
          'scenes':dict(collections.Counter(r['scene'] for r in rows)),
          'accessories':sorted({role['accessory'] for c in cells.values() for role in c['a']+c['b'] if 'accessory' in role}),
          'items':sorted({role['item'] for c in cells.values() for role in c['a']+c['b'] if 'item' in role})}
summary={'baseline':manifest['baseline'],'sourceSha256':manifest['sourceSha256'],'total':stat(rows+policy+armor),'main':stat(rows),'diagnostics':stat(policy),'armorDiagnostics':stat(armor),'armorControls':armor_summary,'coverage':coverage,
         'groups':groups,'scenes':by_scene,'crossWorld':cross_world,'nativePowerGap':native_summary,'sideSwap':pair_summary,
         'cells':by_cell,'usage':usage,'policy':policy_summary,'policyUsage':policy_usage,'logValidation':log_validation}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')

def table(headers, values):
    return '| '+' | '.join(headers)+' |\n| '+' | '.join(['---']*len(headers))+' |\n'+''.join('| '+' | '.join(map(str,v))+' |\n' for v in values)+'\n'

family_names={'same-world':'同世界观','cross-equal':'跨世界观·等P','cross-native':'跨世界观·原生P','mechanics':'机制对照'}
mode_names={'small':'小规模','mass':'会战'}
text='# 2,800 场实战审计：完整统计表\n\n'
text+=f"基线 `{manifest['baseline']}`；2,000 场主矩阵 + 480 场策略诊断 + 320 场护甲单变量对照。试跑和复现核验未计入。主矩阵200个单元×5种子×阵营交换。\n\n"
text+='## 覆盖与口径\n\n'
text+='六类世界观均为本报告编写的引擎模板，不代表作品官方设定。等P仅统一装备与技能强度等级，不统一体型、人数价值、射程或阵容成本。不能把模板胜率理解为整个世界观强弱排名。\n\n'
text+='小规模默认60轮；会战40轮，进入第41轮即到期。轮数统计截于各自上限。到期占点守方胜计为胜，但另列到期数；其他到期平局属于未决。会战使用环境标签与阵位，不使用小规模的格子地形和占点目标。\n\n'
text+='每个主矩阵单元仅5个独立种子及两次阵营交换。交换双方与输入排序仍共享种子，不视为10个独立样本。CI为按单元分层、整对重采样1500次的描述性95%区间；五对小样本和确定性结果可能给出过窄甚至退化区间，不构成普适强弱证明。策略诊断每单元每策略10个种子×交换。\n\n'
text+=table(['维度','覆盖'],[(k,', '.join(map(str,v)) if isinstance(v,list) else v) for k,v in coverage.items()])
text+='## 分组结果\n\nA/B指模板或对照中的固定配装，不是我方/敌方。\n\n'
text+=table(['类别','模式','场数','A胜','B胜','平局','到期','平均轮数'],[[family_names[x['family']],mode_names[x['mode']],x['n'],x['aWins'],x['bWins'],x['draws'],x['limit'],x['meanRounds']] for x in groups])
text+='## 场景结果\n\n各场景阵容不完全相同，场景间汇总不得直接解释为地形的因果效果。\n\n'
text+=table(['场景','模式','场数','平局','到期','平均轮数'],[[x['scene'],mode_names[x['mode']],x['n'],x['draws'],x['limit'],x['meanRounds']] for x in by_scene])
text+='## 跨世界观模板对阵汇总\n\n得分率=(胜+0.5×平)/场数；保留平局率，得分率不是胜率。每世界等P每模式100场，原生P每模式50场。\n\n'
text+=table(['层','模式','模板','场数','胜','平','得分率','配对CI95'],[[family_names[x['family']],mode_names[x['mode']],x['name'],x['n'],x['wins'],x['draws'],str(x['scorePct'])+'%',str(x['scoreCI95'])] for x in cross_world])
text+='## 逐单元结果\n\n配装定义与完整输入见manifest.json；A为名称斜杠/对阵左侧。\n\n'
text+=table(['ID','类别','模式','对阵','A胜','B胜','平','到期','平均轮数','A胜率CI95'],[[x['id'],family_names[x['family']],mode_names[x['mode']],x['name'],x['aWins'],x['bWins'],x['draws'],x['limit'],x['meanRounds'],x['aWinRateCI95']] for x in by_cell])
text+='## 技能与物品实际使用\n\n携带单位场次包括活到结束前被击败的单位；使用率是实际使用过的携带单位场次/携带场次，不能据此单独判断技能有效性。\n\n'
text+=table(['模式','定义','来源','携带单位场次','使用过','总使用次数'],[[mode_names[x['mode']],x['definition'],x['source'],x['equippedUnitBattles'],x['usedUnitBattles'],x['totalUses']] for x in usage])
text+='## 技能优先策略诊断\n\n合法时按技能列表选首个可施放技能，不能施放则退回默认AI；不绕过冷却、SP、射程、抗性或行动次数。此策略用于检验执行与选择差异，不是最优玩家策略。\n\n'
text+=table(['ID','模式','对照','策略','场数','A胜','B胜','平','技能次数'],[[x['cellId'],mode_names[x['mode']],x['name'],x['policy'],x['n'],x['aWins'],x['bWins'],x['draws'],x['abilityUses']] for x in policy_summary])
text+='## 护甲单变量对照\n\n固定T5/P3、人类、无技能无配件、开阔近距；会战50人。20种子×阵营交换=每单元40场。剑/钝器两单元只改护甲档位，步枪/能量两单元只改防护通道。主矩阵中对应对照跨等级，不能替代本组的单变量结论。\n\n'
text+=table(['对照','模式','场数','A胜','B胜','平','平均轮数','A胜率CI95'],[[x['caseId'],mode_names[x['mode']],x['n'],x['aWins'],x['bWins'],x['draws'],x['meanRounds'],x['aWinRateCI95']] for x in armor_summary])
text+='## 阵营与排序敏感性\n\n'+table(['模式','种子对','交换后结果改变','我方胜','敌方胜'],[[mode_names[m],v['pairs'],v['differentOutcome'],v['allyWins'],v['enemyWins']] for m,v in pair_summary.items()])
text+='## 数据校验\n\n已验证：主测试2000条、策略诊断480条、护甲对照320条唯一记录；主矩阵每单元种子与交换齐全；源代码指纹一致；所有战斗由引擎给出终局；主矩阵成员生命分组有效；2800份初始快照与完整日志逐一匹配。单元测试通过与否见审计说明，不由本脚本假定。\n'
(OUT/'statistics.md').write_text(text)
print(json.dumps({k:v for k,v in summary.items() if k not in ['cells','usage','policyUsage','crossWorld']},ensure_ascii=False,indent=2))
