#!/usr/bin/env python3
"""Run paired full-engine combats on isolated copies; never edit the working source.
Requires npm ci and Python 3.11+. Example:
  python3 scripts/compare-overmatch-curves.py --out /tmp/grade-audit --phase holdout
The baseline is intentionally immutable. Each candidate replaces only gradeOvermatch.
"""
from __future__ import annotations
import argparse, concurrent.futures, io, json, pathlib, shutil, subprocess, tarfile, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = '069c4c0f0973a3c99ebda56cf94d5d31e7ab835f'
FORMULAS = {
 'root': 'Math.sqrt(ratio)-1',
 'literal2': '2*Math.sqrt(ratio)-1',
 'bonus2': '2*(Math.sqrt(ratio)-1)',
 'ramp2': '(Math.sqrt(ratio)-1)*(1+gap/(gap+2))',
 'tail2': '(Math.sqrt(ratio)-1)*(1+Math.max(0,gap-1)**2/(1+Math.max(0,gap-1)**2))',
}

def main() -> None:
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--out',type=pathlib.Path,required=True)
 parser.add_argument('--phase',choices=['discovery','holdout'],default='discovery')
 parser.add_argument('--variants',default='baseline,root,literal2,bonus2,ramp2,tail2')
 parser.add_argument('--baseline',default=BASE)
 parser.add_argument('--workers',type=int,default=3)
 args=parser.parse_args();labels=args.variants.split(',')
 if len(labels)!=len(set(labels)) or any(l not in ['baseline',*FORMULAS] for l in labels):parser.error('Unknown/duplicate variant')
 if not 1<=args.workers<=6:parser.error('workers must be 1..6')
 node=ROOT/'node_modules/vite-node/vite-node.mjs'
 if not node.exists():parser.error('Run npm ci before this audit')
 archive=subprocess.check_output(['git','archive',args.baseline],cwd=ROOT)
 out=args.out.resolve()/args.phase;out.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='tb-grade-audit-') as temp:
  def run(label: str) -> dict:
   work=pathlib.Path(temp)/label;work.mkdir()
   with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
    for member in tf.getmembers():
     if member.name.startswith('/') or '..' in pathlib.PurePosixPath(member.name).parts or member.issym() or member.islnk():raise ValueError('Unsafe archive member')
    tf.extractall(work)
   (work/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
   shutil.copy(ROOT/'scripts/audit-overmatch-curves.ts',work/'scripts/audit-overmatch-curves.ts')
   power=work/'engine/src/power-anchors.ts';source=power.read_text()
   if label!='baseline':
    start=source.index('export function gradeOvermatch(');end=source.index('\ntype DefensiveTarget',start)
    function='''export function gradeOvermatch(power:number|undefined,defensePower:number,penetration:number,resistance:number):number {
 if(power===undefined||!Number.isFinite(power)||power<1||power>10||power<=defensePower)return 1;
 const gap=power-defensePower,ratio=continuousPowerBudget(power)/continuousPowerBudget(defensePower);
 const extra=EXPRESSION;
 return 1+extra*Math.max(0,Math.min(1,penetration-resistance));
}'''.replace('EXPRESSION',FORMULAS[label])
    power.write_text(source[:start]+function+source[end:])
   with (out/f'progress-{label}.log').open('w') as log:
    subprocess.run(['node',str(node),'scripts/audit-overmatch-curves.ts',f'--label={label}',f'--out={out}',f'--phase={args.phase}'],cwd=work,stdout=log,stderr=subprocess.STDOUT,check=True)
   rows=[json.loads(line)for line in (out/f'{label}-{args.phase}-0.jsonl').read_text().splitlines()]
   if len(rows)!=2400 or any('error'in r or not r.get('finished')for r in rows):raise RuntimeError(f'{label}: incomplete battles')
   return {'variant':label,'battles':len(rows)}
  with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers)as pool:
   for result in pool.map(run,labels):print(json.dumps(result),flush=True)

if __name__=='__main__':main()
