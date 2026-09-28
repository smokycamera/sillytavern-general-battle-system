"""Summarize paired production-engine RNG runs; never substitutes for running them."""
import argparse
import collections
import json
import statistics
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('old', type=Path)
parser.add_argument('new', type=Path)
parser.add_argument('--out', type=Path, default=Path('docs/instance-variance-results.json'))
a = parser.parse_args()
old, new = [[json.loads(line) for line in p.read_text().splitlines()] for p in (a.old, a.new)]
if not old or len(old) != len(new) or any(x.get('error') or not x.get('finished') for x in old + new):
    raise ValueError('Missing, unfinished or failed battles; cannot summarize as passed')
if [x['id'] for x in old] != [x['id'] for x in new]:
    raise ValueError('Battle IDs do not match')
def summary(rows):
    return dict(battles=len(rows), result=dict(collections.Counter(x['result'] for x in rows)),
                meanRounds=statistics.mean(x['rounds'] for x in rows), medianRounds=statistics.median(x['rounds'] for x in rows),
                oneShotBattles=sum(x['oneShotBattle'] for x in rows))
report = dict(baselineCommit='c51aada22024a7c12c6a7a09d1f180861e867730',
              battlesExecuted=len(old)+len(new), pairedBattles=len(old), errors=0,
              old=summary(old), bands=summary(new),
              changedOutcomes=sum(x['result'] != y['result'] for x,y in zip(old,new)),
              modes={m:dict(old=summary([x for x in old if x['mode']==m]), bands=summary([x for x in new if x['mode']==m])) for m in ['small','mass']},
              note='A is the designed stronger/different team in many scenarios, not a balanced player faction. Paired sensitivity audit, not a universal win-rate estimate.')
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False))
