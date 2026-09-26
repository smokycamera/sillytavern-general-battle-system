"""Validate complete paired batches and create the checked-in numeric report."""
from pathlib import Path
import collections, gzip, hashlib, json, statistics

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/signed-skill-balance-20260926'
OUT.mkdir(parents=True, exist_ok=True)
SIM = ROOT / 'engine/sim/out'

def read_rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]

def unique(rows, expected, label):
    ids = [r['id'] for r in rows]
    assert len(ids) == expected and len(set(ids)) == expected, (label, len(ids), len(set(ids)), expected)

def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items() if k != 'effectVersion'}
    if isinstance(value, list):
        return list(map(canonical, value))
    return value

def wilson(k, n):
    z = 1.959963984540054
    center = (k / n + z*z / (2*n)) / (1+z*z/n)
    half = z * ((k/n*(1-k/n)+z*z/(4*n))/n)**.5 / (1+z*z/n)
    return [round(100*(center-half), 2), round(100*(center+half), 2)]

replay = sorted([r for p in (SIM/'signed-skill-regression').glob('worker-*.jsonl') for r in read_rows(p)], key=lambda r:r['id'])
unique(replay, 2240, 'frozen snapshots')
before = sorted(read_rows(SIM/'support-baseline-v2/results.jsonl'), key=lambda r:r['id'])
after = sorted(read_rows(SIM/'support-candidate-v2/results.jsonl'), key=lambda r:r['id'])
unique(before, 320, 'support baseline'); unique(after, 320, 'support candidate')
team_before=read_rows(SIM/'control-teams-baseline/results.jsonl'); team_after=read_rows(SIM/'control-teams-candidate/results.jsonl')
unique(team_before,80,'team baseline'); unique(team_after,80,'team candidate')
before=sorted(before+team_before,key=lambda r:r['id']); after=sorted(after+team_after,key=lambda r:r['id'])
channels=read_rows(SIM/'signed-channel-battles/results.jsonl'); unique(channels,324,'signed channels')
assert [r['id'] for r in before] == [r['id'] for r in after]

artifacts = []
for folder, expected in [('signed-skill-regression', 2240), ('support-baseline-v2', 320), ('support-candidate-v2', 320), ('control-teams-baseline',80), ('control-teams-candidate',80), ('signed-channel-battles',324)]:
    rows = []
    for p in sorted((SIM/folder).glob('*.jsonl.gz')):
        with gzip.open(p, 'rt') as f:
            for line in f:
                r=json.loads(line); assert isinstance(r['initialSnapshot']['combatants'],list) and r['log']; rows.append(r['id'])
        artifacts.append({'path':str(p.relative_to(ROOT)), 'bytes':p.stat().st_size, 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    assert len(rows)==expected and len(set(rows))==expected, (folder,'log count',len(rows),len(set(rows)))
    source_rows = replay if folder=='signed-skill-regression' else channels if folder=='signed-channel-battles' else team_before if folder=='control-teams-baseline' else team_after if folder=='control-teams-candidate' else [r for r in (before if folder=='support-baseline-v2' else after) if not r['name'].endswith('-team')]
    result_ids={r['id'] for r in source_rows}
    assert set(rows)==result_ids, (folder,'unpaired logs')

def load_logs(folder):
    return {r['id']:r for r in map(json.loads, gzip.open(SIM/folder/'logs.jsonl.gz','rt'))}

old_logs=load_logs('support-baseline-v2')|load_logs('control-teams-baseline'); new_logs=load_logs('support-candidate-v2')|load_logs('control-teams-candidate')
assert all(canonical(old_logs[k]['initialSnapshot'])==canonical(new_logs[k]['initialSnapshot']) for k in old_logs), 'Paired initial conditions differ beyond formula version'

def metrics(rows):
    n=len(rows); used=sum(r.get('used',0)>0 for r in rows)
    return {'n':n,'wins':dict(collections.Counter(r['result'] for r in rows)), 'cast_battles':used, 'cast_total':sum(r.get('used',0) for r in rows),
            'cast_rate_wilson95_percent':wilson(used,n), 'median_rounds':statistics.median(r['roundsObserved'] for r in rows)}

support=[]
for name in dict.fromkeys(r['name'] for r in after):
    for mode in ['small','mass','both']:
        select=lambda rows:[r for r in rows if r['name']==name and (mode=='both' or r['mode']==mode)]
        support.append({'scenario':name,'mode':mode,'before':metrics(select(before)),'after':metrics(select(after))})

manifest=json.loads((SIM/'worldview-2000/manifest.json').read_text()); cells={r['id']:r for r in manifest['cells']}
matrix=[]
for family in sorted({cells[r['cellId']]['family'] for r in replay if r['suite']=='worldview-2000'}):
    rows=[r for r in replay if r['suite']=='worldview-2000' and cells[r['cellId']]['family']==family]
    for mode in ['small','mass']:
        rs=[r for r in rows if r['mode']==mode]
        matrix.append({'family':family,'mode':mode,'n':len(rs),'changed_winner':sum(r['result']!=r['before']['result'] for r in rs),
            'draw_before':sum(r['before']['result']=='draw' for r in rs),'draw_after':sum(r['result']=='draw' for r in rs),
            'median_rounds_before':statistics.median(r['before']['roundsObserved'] for r in rs), 'median_rounds_after':statistics.median(r['roundsObserved'] for r in rs)})
policy=[]
for cell in sorted({r['cellId'] for r in replay if r['suite']=='skill-policy-480'}):
    rows=[r for r in replay if r['suite']=='skill-policy-480' and r['cellId']==cell]
    policy.append({'cell':cell,'name':cells[cell]['name'],'mode':rows[0]['mode'],'n':len(rows),
      'before_casts':sum(u['used'] for r in rows for u in r['before']['usage']), 'after_casts':sum(u['used'] for r in rows for u in r['usage']),
      'before_cast_battles':sum(any(u['used'] for u in r['before']['usage']) for r in rows), 'after_cast_battles':sum(any(u['used'] for u in r['usage']) for r in rows),
      'draw_before':sum(r['before']['result']=='draw' for r in rows), 'draw_after':sum(r['result']=='draw' for r in rows)})

summary={'baseline':'86d719dc4931a77d99ddd0ee19638d81c0eaefb2','new_battles':3364,'candidate_battles':2964,'baseline_battles':400,
 'frozen_replay_battles':2240,'paired_support_snapshots_equal_except_formula_version':True, 'support':support,'worldview':matrix,'original_policy_cells':policy,'signed_channels':[{ 'channel':channel,'stat':stat,'points':points,'mode':mode, 'metrics':metrics([r for r in channels if r['channel']==channel and r['stat']==stat and r['points']==points and (mode=='both' or r['mode']==mode)])} for channel in ['kinetic','thermal','arcane'] for stat in ['Damage','Penetration','Protection'] for points in [-10,0,10] for mode in ['small','mass','both']], 'logs':artifacts,
 'limits':['Worldview cells are templates, not equal-cost armies.','A draw at the turn cap is censored, not evidence of balance.','Five paired seeds per side per support mode; mirrored observations are correlated. Wilson intervals are descriptive, not independent-trial significance.','AI uses a bounded one-action/two-status-boundary estimate, not optimal multi-turn play.']}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
(OUT/'battles.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in replay+[dict(r,suite='support-before') for r in before]+[dict(r,suite='support-after') for r in after]+[dict(r,suite='signed-channels') for r in channels]))
lines=['# 对战统计','', '合计 3,364 场新实战：候选版 2,964 场、主分支对照 400 场。每场均由真实引擎运行至结束，另计单元测试中的伤害抽样。','',
'## 情境技能（每行修改前后各20场）','', '|情境|施法场数：前→后|施法次数：前→后|A胜/负/平：前→后|回合中位数：前→后|','|---|---:|---:|---|---:|']
for r in support:
    if r['mode']!='both':continue
    a,b=r['before'],r['after'];w=lambda x:'/'.join(str(x['wins'].get(k,0)) for k in ['A','B','draw'])
    lines.append(f"|{r['scenario']}|{a['cast_battles']}→{b['cast_battles']}|{a['cast_total']}→{b['cast_total']}|{w(a)}→{w(b)}|{a['median_rounds']}→{b['median_rounds']}|")
lines+=['','## 原2,000场世界观矩阵的同初始快照复测','', '|分类|模式|场数|胜负改变|平局：前→后|回合中位数：前→后|','|---|---|---:|---:|---:|---:|']
for r in matrix:lines.append(f"|{r['family']}|{r['mode']}|{r['n']}|{r['changed_winner']}|{r['draw_before']}→{r['draw_after']}|{r['median_rounds_before']}→{r['median_rounds_after']}|")
lines+=['','## 原默认AI技能诊断矩阵的240场复测','', '|组合|模式|场数|有施法场数：前→后|施法次数：前→后|平局：前→后|','|---|---|---:|---:|---:|---:|']
for r in policy:lines.append(f"|{r['name']}|{r['mode']}|{r['n']}|{r['before_cast_battles']}→{r['after_cast_battles']}|{r['before_casts']}→{r['after_casts']}|{r['draw_before']}→{r['draw_after']}|")
lines+=['','## 正负单通道实战（每个点数每行12场）','', '|通道|修正方向|−10：A胜/负/平|0：A胜/负/平|+10：A胜/负/平|','|---|---|---|---|---|']
for channel in ['kinetic','thermal','arcane']:
    for stat in ['Damage','Penetration','Protection']:
        cells=[]
        for points in [-10,0,10]:
            rs=[r for r in channels if r['channel']==channel and r['stat']==stat and r['points']==points]
            counts=collections.Counter(r['result'] for r in rs);cells.append('/'.join(str(counts[k]) for k in ['A','B','draw']))
        lines.append('|'+channel+'|'+stat+'|'+'|'.join(cells)+'|')
lines+=['','胜率不能跨情境直接合并解释为强弱。高威胁测试刻意让施法者装备较弱；更多施法不保证逆转技术差距。完整分模式数字和描述性95%区间见summary.json，逐场记录见battles.jsonl。','']
(OUT/'statistics.md').write_text('\n'.join(lines))
print(json.dumps({'battles':3364,'paired_support':400,'log_files':len(artifacts),'output':str(OUT)}))
